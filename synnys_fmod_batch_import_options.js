studio.menu.addMenuItem({
    name: "Scripts\\SynnyS Batch Import With Options",
    execute: function () {

        // -------------------------------------------------------------------------
        // UTILITIES
        // -------------------------------------------------------------------------

        var importOptions = { mode: 'manual', instrument: 'single', sheet: 'action', spatial: false, loop: false };

        function normalizePath(path) {
            return path.replace(/\\/g, '/').replace(/\/+$/, '');
        }

        function writeLog(path, content) {
            try {
                var logFile = studio.system.getFile(path + "/fmod_import_log.txt");
                logFile.open(studio.system.openMode.WriteOnly);
                logFile.writeText(content);
                logFile.close();
                return true;
            } catch (error) {
                studio.system.message("Error writing log file: " + error);
                return false;
            }
        }

        function formatLogEntry(status, file, reason) {
            var date = new Date();
            return date.toLocaleTimeString() + " - " + status + ": " + file +
                   (reason ? " (" + reason + ")" : "") + "\n";
        }

        // -------------------------------------------------------------------------
        // FILE COLLECTION
        // -------------------------------------------------------------------------

        var MAX_DEPTH = 10;

        function isDirectory(fullPath) {
            // Prefer a direct API check if available; fall back to readDir attempt
            if (typeof studio.system.isDirectory === 'function') {
                return studio.system.isDirectory(fullPath);
            }
            try {
                studio.system.readDir(fullPath);
                return true;
            } catch (e) {
                return false;
            }
        }

        function collectAudioFiles(dirPath, depth) {
            if (depth === undefined) depth = 0;
            if (depth > MAX_DEPTH) return [];

            dirPath = normalizePath(dirPath);
            var audioFiles = [];

            try {
                var entries = studio.system.readDir(dirPath);

                for (var i = 0; i < entries.length; i++) {
                    var entry = entries[i];
                    if (entry === "." || entry === "..") continue;

                    var fullPath = dirPath + "/" + entry;

                    if (entry.toLowerCase().match(/\.(wav|mp3|ogg|aif|aiff|flac)$/)) {
                        audioFiles.push(fullPath);
                    } else if (isDirectory(fullPath)) {
                        audioFiles = audioFiles.concat(collectAudioFiles(fullPath, depth + 1));
                    }
                }
            } catch (error) {
                studio.system.message("Error scanning directory: " + error);
            }

            return audioFiles;
        }

        // -------------------------------------------------------------------------
        // NAMING CONVENTION PARSER
        //
        // Supported suffixes (case-insensitive, can combine):
        //   _3d      spatial / spatialiser effect
        //   _loop    set loop region on timeline
        //   _multi_N random multi-sound instrument
        //   _scat_N  sound scatterer (always 3D)
        // -------------------------------------------------------------------------

        function getBaseNameAndType(filename) {
            var dotIndex = filename.lastIndexOf('.');
            var baseName = dotIndex !== -1 ? filename.substring(0, dotIndex) : filename;
            if (importOptions.mode === 'manual') {
                return { baseName: baseName, type: importOptions.instrument,
                    flags: { is3d: importOptions.spatial, isLoop: importOptions.loop } };
            }
            var lower = baseName.toLowerCase();

            var flags = {
                is3d:   lower.indexOf('_3d')   !== -1,
                isLoop: lower.indexOf('_loop') !== -1
            };

            // Determine instrument type and strip suffix cluster from base name
            var type, cleanBase;

            var multiMatch = baseName.match(/^(.+?)_multi_\d+/i);
            var scatMatch  = baseName.match(/^(.+?)_scat_\d+/i);

            if (multiMatch) {
                cleanBase = multiMatch[1];
                type = 'multi';
            } else if (scatMatch) {
                cleanBase = scatMatch[1];
                type = 'scatter'; // Scatter is always 3D
                flags.is3d = true;
            } else {
                // Strip known flag suffixes from single-file names
                cleanBase = baseName
                    .replace(/_3d/gi, '')
                    .replace(/_loop/gi, '')
                    .replace(/_+$/, ''); // trim trailing underscores
                type = 'single';
            }

            return { baseName: cleanBase, type: type, flags: flags };
        }

        // -------------------------------------------------------------------------
        // FILE GROUPING
        // -------------------------------------------------------------------------

        function groupFiles(files, rootPath) {
            var groups = Object.create(null);

            files.forEach(function (filePath) {
                var relPath  = filePath.substring(rootPath.length + 1);
                var lastSlash  = relPath.lastIndexOf('/');
                var folderPath = lastSlash !== -1 ? relPath.substring(0, lastSlash) : "";
                var filename   = lastSlash !== -1 ? relPath.substring(lastSlash + 1) : relPath;

                var info = getBaseNameAndType(filename);
                // Manual multi imports collect variations per source folder.
                if (importOptions.mode === 'manual' && importOptions.instrument === 'multi') {
                    info.baseName = (folderPath || rootPath).split('/').pop();
                }
                var key = (folderPath ? folderPath + '/' : '') + info.baseName + '|' + info.type;

                if (!groups[key]) {
                    groups[key] = {
                        baseName:   info.baseName,
                        type:       info.type,
                        flags:      info.flags,
                        folderPath: folderPath,
                        files:      []
                    };
                }
                groups[key].files.push(filePath);
            });

            return groups;
        }

        // -------------------------------------------------------------------------
        // FOLDER CREATION
        // -------------------------------------------------------------------------

        // Cache scoped to this import session to avoid redundant lookups
        var folderCache = {};

        function createEventFolder(path, rootFolder) {
            var cleanPath   = path.replace(/\\/g, '/').trim();
            if (!cleanPath) return rootFolder;

            var folderNames = cleanPath.split('/').filter(function (f) { return f.length > 0; });
            var currentPath = "";
            var currentFolder = rootFolder;

            for (var i = 0; i < folderNames.length; i++) {
                currentPath += (currentPath ? "/" : "") + folderNames[i];

                if (folderCache[currentPath]) {
                    currentFolder = folderCache[currentPath];
                    continue;
                }

                var existingFolder = null;
                for (var j = 0; j < currentFolder.items.length; j++) {
                    if (currentFolder.items[j].isOfExactType('EventFolder') &&
                        currentFolder.items[j].name === folderNames[i]) {
                        existingFolder = currentFolder.items[j];
                        break;
                    }
                }

                if (!existingFolder) {
                    existingFolder = studio.project.create('EventFolder');
                    existingFolder.name   = folderNames[i];
                    existingFolder.folder = currentFolder;
                }

                folderCache[currentPath] = existingFolder;
                currentFolder = existingFolder;
            }

            return currentFolder;
        }

        // -------------------------------------------------------------------------
        // DUPLICATE CHECK
        // Checks both name AND folder path to avoid false positives
        // -------------------------------------------------------------------------

        function eventExistsInFolder(name, targetFolder) {
            var events = studio.project.model.Event.findInstances();
            for (var i = 0; i < events.length; i++) {
                if (events[i].name === name && events[i].folder === targetFolder) {
                    return true;
                }
            }
            return false;
        }

        // -------------------------------------------------------------------------
        // ASSET LENGTH HELPER
        // Returns the length of the longest asset in a list of file paths
        // -------------------------------------------------------------------------

        function getLongestAssetLength(filePaths) {
            var maxLength = 0; // fallback applies only when no duration is available
            filePaths.forEach(function (filePath) {
                try {
                    var asset = studio.project.importAudioFile(filePath);
                    if (asset && asset.length && asset.length > maxLength) {
                        maxLength = asset.length;
                    }
                } catch (e) { /* ignore */ }
            });
            return maxLength || 10;
        }

        // -------------------------------------------------------------------------
        // EVENT CREATION
        //
        // conflictMode: 'skip' | 'overwrite' | 'rename'
        // -------------------------------------------------------------------------

        function createEventFromGroup(group, conflictMode, logEntries) {
            try {
                if (!group.baseName || (group.type === 'single' && group.files.length !== 1)) {
                    throw new Error('Single events require one file with a unique, nonempty basename.');
                }
                var targetFolder = group.folderPath
                    ? createEventFolder(group.folderPath, studio.project.workspace.masterEventFolder)
                    : studio.project.workspace.masterEventFolder;

                var eventName = group.baseName;

                // --- Conflict resolution ---
                if (eventExistsInFolder(eventName, targetFolder)) {
                    if (conflictMode === 'skip') {
                        logEntries.push(formatLogEntry("SKIPPED", eventName, "Event already exists"));
                        return 'skipped';
                    } else if (conflictMode === 'overwrite') {
                        // Remove existing event
                        var existing = studio.project.model.Event.findInstances().filter(function (e) {
                            return e.name === eventName && e.folder === targetFolder;
                        });
                        if (existing.length > 0) {
                            existing[0].isDestroyed = true;
                            logEntries.push(formatLogEntry("INFO", eventName, "Removed existing event for overwrite"));
                        }
                    } else if (conflictMode === 'rename') {
                        var counter = 1;
                        while (eventExistsInFolder(eventName + "_" + counter, targetFolder)) {
                            counter++;
                        }
                        eventName = eventName + "_" + counter;
                        logEntries.push(formatLogEntry("INFO", group.baseName, "Renamed to " + eventName));
                    }
                }

                // --- Create event ---
                var event = studio.project.create("Event");
                event.name   = eventName;
                event.folder = targetFolder;

                var flags = group.flags;
                // Loops retain the original timeline-region semantics; scatter stays on a timeline.
                var useAction = importOptions.sheet === 'action' && !flags.isLoop && group.type !== 'scatter';
                var track = useAction ? event.masterTrack : event.addGroupTrack();

                // --- Instrument setup ---
                var resolvedLength = 10; // fallback, updated per instrument type below
                if (useAction) {
                    var actionSheet = studio.project.create('ActionSheet');
                    var container = studio.project.create('MultiSound');
                    actionSheet.modules = container;
                    event.relationships.parameters.add(actionSheet);
                    container.audioTrack = event.masterTrack;
                    event.timeline.isProxyEnabled = false;
                    var owner = container;
                    if (group.type === 'multi') {
                        owner = studio.project.create('MultiSound');
                        owner.owner = container;
                        owner.name = eventName;
                    }
                    for (var ai = 0; ai < group.files.length; ai++) {
                        var actionAsset = studio.project.importAudioFile(group.files[ai]);
                        if (!actionAsset) throw new Error('Failed to import ' + group.files[ai]);
                        var actionSound = studio.project.create('SingleSound');
                        actionSound.audioFile = actionAsset;
                        actionSound.owner = owner;
                        logEntries.push(formatLogEntry('ADDED', group.files[ai], 'Added to action sheet'));
                    }
                } else if (group.type === 'multi') {
                    var eventLength = getLongestAssetLength(group.files);
                    resolvedLength = eventLength;
                    var multiSound  = track.addSound(event.timeline, 'MultiSound', 0, eventLength);
                    multiSound.name = eventName;

                    group.files.forEach(function (filePath) {
                        var asset = studio.project.importAudioFile(filePath);
                        if (asset) {
                            var singleSound       = studio.project.create('SingleSound');
                            singleSound.audioFile = asset;
                            singleSound.owner     = multiSound;
                            logEntries.push(formatLogEntry("ADDED", filePath, "Added to multi sound"));
                        } else {
                            logEntries.push(formatLogEntry("FAILED", filePath, "Failed to import audio"));
                        }
                    });

                } else if (group.type === 'scatter') {
                    var eventLength      = getLongestAssetLength(group.files);
                    resolvedLength = eventLength;
                    var scattererSound   = track.addSound(event.timeline, 'SoundScatterer', 0, eventLength);
                    scattererSound.name  = eventName;

                    group.files.forEach(function (filePath) {
                        var asset = studio.project.importAudioFile(filePath);
                        if (asset) {
                            var singleSound       = studio.project.create('SingleSound');
                            singleSound.audioFile = asset;
                            // scattererSound.sound holds the MultiSound inside the scatterer
                            try {
                                singleSound.owner = scattererSound.sound;
                            } catch (e) {
                                // Fallback: some versions expose it differently
                                singleSound.owner = scattererSound;
                                logEntries.push(formatLogEntry("WARN", filePath, "Used fallback scatterer ownership"));
                            }
                            logEntries.push(formatLogEntry("ADDED", filePath, "Added to scatter sound"));
                        } else {
                            logEntries.push(formatLogEntry("FAILED", filePath, "Failed to import audio"));
                        }
                    });

                } else {
                    // Single sound
                    var asset = studio.project.importAudioFile(group.files[0]);
                    if (asset) {
                        resolvedLength = asset.length || 10;
                        var sound      = track.addSound(event.timeline, 'SingleSound', 0, resolvedLength);
                        sound.audioFile = asset;
                        sound.length    = resolvedLength;
                        sound.name      = eventName;
                        logEntries.push(formatLogEntry("ADDED", group.files[0], "Created single sound"));
                    } else {
                        logEntries.push(formatLogEntry("FAILED", group.files[0], "Failed to import audio"));
                        return 'failed';
                    }
                }

                // --- Spatialiser ---
                if (flags.is3d) {
                    event.masterTrack.mixerGroup.effectChain.addEffect('SpatialiserEffect');
                    logEntries.push(formatLogEntry("INFO", eventName, "Added spatialiser"));
                }

                // --- Loop region ---
                // Source: FMOD staff example (qa.fmod.com/t/21891)
                // LoopRegion must be created as a project object and assigned
                // a MarkerTrack, timeline, and selector (the event).
                if (flags.isLoop) {
                    try {
                        var loopMarkerTrack = studio.project.create("MarkerTrack");
                        loopMarkerTrack.event = event;

                        if (loopMarkerTrack.isValid) {
                            var loopRegion = studio.project.create("LoopRegion");
                            loopRegion.position   = 0;
                            loopRegion.length     = resolvedLength;
                            loopRegion.selector   = event;
                            loopRegion.timeline   = event.timeline;
                            loopRegion.markerTrack = loopMarkerTrack;

                            if (loopRegion.isValid) {
                                logEntries.push(formatLogEntry("INFO", eventName, "Set loop region (length: " + resolvedLength + ")"));
                            } else {
                                studio.project.deleteObject(loopRegion);
                                logEntries.push(formatLogEntry("WARN", eventName, "Loop region created but invalid, deleted"));
                            }
                        } else {
                            studio.project.deleteObject(loopMarkerTrack);
                            logEntries.push(formatLogEntry("WARN", eventName, "Could not create marker track for loop region"));
                        }
                    } catch (e) {
                        logEntries.push(formatLogEntry("WARN", eventName, "Could not set loop region: " + e));
                    }
                }

                logEntries.push(formatLogEntry("SUCCESS", eventName, "Event created successfully"));
                return 'success';

            } catch (error) {
                logEntries.push(formatLogEntry("ERROR", group.baseName, error.toString()));
                return 'failed';
            }
        }

        // -------------------------------------------------------------------------
        // DRY RUN PREVIEW
        // -------------------------------------------------------------------------

        function buildPreviewText(groups, conflictMode) {
            var lines = [];
            var groupKeys = Object.keys(groups);

            groupKeys.forEach(function (key) {
                var g = groups[key];
                var folder = g.folderPath || "(root)";
                var flagList = [];
                if (g.flags.is3d)   flagList.push("3D");
                if (g.flags.isLoop) flagList.push("loop");
                var flagStr = flagList.length ? " [" + flagList.join(", ") + "]" : "";

                var typeLabel = {
                    single:  "Single",
                    multi:   "Multi (" + g.files.length + " variations)",
                    scatter: "Scatter (" + g.files.length + " variations)"
                }[g.type] || g.type;

                var sheetLabel = importOptions.sheet === 'action' && !g.flags.isLoop && g.type !== 'scatter'
                    ? 'Action' : 'Timeline';
                typeLabel += ' / ' + sheetLabel + (g.flags.is3d ? ' / 3D' : ' / 2D');
                lines.push(folder + " / " + g.baseName + "  —  " + typeLabel + flagStr);
            });

            return lines.join("\n");
        }

        // -------------------------------------------------------------------------
        // MAIN DIALOG
        // -------------------------------------------------------------------------

        // Native controls; changing settings invalidates the previous preview.
        var conflictMode = 'skip';
        var ready = false;
        var ui = studio.ui, W = ui.widgetType, L = ui.layoutType;
        function refresh(widget) {
            if (!ready) return;
            var manual = importOptions.mode === 'manual';
            widget.findWidget('manualSettings').setVisible(manual);
            widget.findWidget('suffixHelp').setVisible(!manual);
            ready = false;
            widget.findWidget('sheetChoice').setCurrentIndex(manual && importOptions.loop ? 1 : (importOptions.sheet === 'action' ? 0 : 1));
            ready = true;
            widget.findWidget('sheetChoice').setEnabled(!manual || !importOptions.loop);
            widget.findWidget('sheetHelp').setText(manual && importOptions.loop
                ? 'Looping uses a timeline with a loop region.'
                : 'Action plays on trigger. Timeline supports timed arrangement.');
            widget.findWidget('groupHelp').setText(importOptions.instrument === 'single'
                ? 'Each file becomes an event, named after the file without its extension.'
                : 'Files in each source folder become one variation event, named after that folder.');
            widget.findWidget('conflictHelp').setText(conflictMode === 'overwrite'
                ? 'Replace deletes and recreates matching events. Their GUIDs change.'
                : conflictMode === 'rename' ? 'Keep existing events and add a numbered name for each new duplicate.'
                : 'Existing events are left as they are.');
            widget.findWidget('summary').setText(manual
                ? (importOptions.instrument === 'single' ? 'One event per file' : 'One variation event per folder') + '  |  ' +
                  (importOptions.spatial ? '3D' : '2D') + '  |  ' + (importOptions.loop ? 'Loop / Timeline' : 'One-shot / ' + (importOptions.sheet === 'action' ? 'Action' : 'Timeline'))
                : 'Use filename suffixes. Loop and scatter events use timelines.');
            widget.findWidget('preview').setText('Choose Preview to check the event names and settings.');
        }
        function combo(id, labels, index, change) {
            return { widgetType: W.ComboBox, widgetId: id, currentIndex: index,
                items: labels.map(function (text) { return {text: text}; }),
                onCurrentIndexChanged: function () { if (!ready) return; change(this.currentIndex()); refresh(this); }
            };
        }
        function label(text) { return {widgetType: W.Label, text: text, wordWrap: true}; }
        function row(text, control) {
            var title = label(text); title.minimumWidth = 130;
            title.sizePolicy = {horizontalPolicy: ui.sizePolicy.Fixed, verticalPolicy: ui.sizePolicy.Preferred};
            title.alignment = ui.alignment.AlignVCenter;
            control.stretchFactor = 1;
            return {widgetType: W.Layout, layout: L.HBoxLayout, spacing: 12, contentsMargins: {left:0, top:0, right:0, bottom:0}, items: [title, control]};
        }
        function scan(widget) {
            var path = normalizePath(widget.findWidget('source').text().trim());
            if (!path) { studio.system.message('Choose a source folder first.'); return null; }
            var files = collectAudioFiles(path);
            if (!files.length) { studio.system.message('No supported audio files found in this folder.'); return null; }
            files.sort();
            var groups = groupFiles(files, path);
            return {path:path, files:files, groups:groups, keys:Object.keys(groups)};
        }
        function showPreview(widget, plan) {
            widget.findWidget('preview').setText(plan.files.length + ' audio files → ' + plan.keys.length +
                ' proposed events\nExisting events: ' + (conflictMode === 'overwrite' ? 'Replace' : conflictMode === 'rename' ? 'Create numbered copies' : 'Skip') +
                '\nCounts below are before conflict handling.\n\n' + buildPreviewText(plan.groups, conflictMode));
        }
        studio.ui.showModalDialog({
            windowTitle: 'SynnyS — Batch Audio Import', windowWidth: 720, windowHeight: 780,
            widgetType: W.Layout, layout: L.VBoxLayout, spacing: 10,
            contentsMargins: {left:20, top:16, right:20, bottom:16},
            onConstructed: function () { ready = true; refresh(this); },
            items: [
                label('Import audio'),
                {widgetType: W.PathLineEdit, widgetId:'source', label:'Source folder',
                    caption:'Choose audio folder', pathType:ui.pathType.Directory,
                    onEditingFinished:function () { refresh(this); }},
                label('Includes subfolders and preserves their event-folder structure.'),
                row('Import method', combo('mode', ['Choose settings', 'Use filename suffixes'], 0, function (i) {
                    importOptions.mode = i === 0 ? 'manual' : 'suffix';
                })),
                {widgetType:W.Layout, widgetId:'manualSettings', layout:L.VBoxLayout, spacing:8, contentsMargins:{left:0, top:0, right:0, bottom:0}, items:[
                    row('Create', combo('instrument', ['An event for each file (Single)', 'A variation event for each folder (Multi)'], 0, function(i){importOptions.instrument=i===0?'single':'multi';})),
                    {widgetType:W.Label, widgetId:'groupHelp', wordWrap:true, text:''},
                    row('Sound placement', combo('spatial', ['2D — no positional attenuation', '3D — add a spatializer'],0,function(i){importOptions.spatial=i===1;})),
                    row('Playback', combo('playback', ['Play once', 'Loop'],0,function(i){importOptions.loop=i===1;}))
                ]},
                {widgetType:W.Label, widgetId:'suffixHelp', isVisible:false, wordWrap:true,
                    text:'Add suffixes before the file extension to choose how each sound is imported:\n\n' +
                         '• No suffix — one 2D, one-shot event per file. Example: greeting.wav\n' +
                         '• _3d — adds a spatializer for positional audio. Example: greeting_3d.wav\n' +
                         '• _loop — repeats playback using a timeline loop region. Example: wind_loop.wav\n' +
                         '• _multi_N — groups numbered files in the same folder into one multi-instrument event.\n' +
                         '  Example: footsteps_multi_1.wav and footsteps_multi_2.wav become footsteps.\n' +
                         '• _scat_N — groups numbered files into a 3D scatterer event on a timeline.\n' +
                         '  Example: birds_scat_1.wav and birds_scat_2.wav become birds.\n\n' +
                         'Combine suffixes: footsteps_multi_1_3d_loop.wav creates a 3D, looping multi event.\n' +
                         'Replace N with a variation number. Put _3d and _loop after _multi_N or _scat_N.\n' +
                         'Use matching flags on every file in a group. Single-file flags are removed from event names;\n' +
                         'grouped event names use the part before _multi_N or _scat_N.'},
                row('Event sheet', combo('sheetChoice', ['Action sheet', 'Timeline'],0,function(i){importOptions.sheet=i===0?'action':'timeline';})),
                {widgetType:W.Label, widgetId:'sheetHelp', wordWrap:true,text:''},
                row('Existing events', combo('conflicts', ['Skip existing', 'Create numbered copies', 'Replace existing'],0,function(i){conflictMode=['skip','rename','overwrite'][i];})),
                {widgetType:W.Label, widgetId:'conflictHelp', wordWrap:true,text:''},
                {widgetType:W.Label, widgetId:'summary', wordWrap:true,text:''},
                {widgetType:W.TextEdit, widgetId:'preview', isReadOnly:true, minimumHeight:170, stretchFactor:1,
                    text:'Choose Preview to check the event names and settings.'},
                {widgetType:W.Layout, layout:L.HBoxLayout, spacing:8, contentsMargins:{left:0, top:0, right:0, bottom:0},items:[
                    {widgetType:W.PushButton,text:'Cancel',onClicked:function(){this.closeDialog();}},
                    {widgetType:W.Spacer,stretchFactor:1},
                    {widgetType:W.PushButton,text:'Preview',onClicked:function(){var p=scan(this);if(p)showPreview(this,p);}},
                    {widgetType:W.PushButton,text:'Import',onClicked:function(){
                        var plan=scan(this); if(!plan)return;
                        showPreview(this,plan);
                        if(conflictMode==='overwrite' && !studio.system.question('Replace matching events? This deletes and recreates them, changing their GUIDs.'))return;
                        folderCache={}; var logs=[],success=0,skipped=0,failed=0;
                        for(var i=0;i<plan.keys.length;i++){
                            var result=createEventFromGroup(plan.groups[plan.keys[i]],conflictMode,logs);
                            if(result==='success')success++;else if(result==='skipped')skipped++;else failed++;
                        }
                        var summary='Import complete\nCreated: '+success+'   Skipped: '+skipped+'   Failed: '+failed;
                        this.findWidget('preview').setText(summary+'\n\n'+logs.join(''));
                        studio.system.message(summary);
                    }}
                ]}
            ]
        });
    }
});
