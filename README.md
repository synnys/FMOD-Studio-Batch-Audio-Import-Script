# FMOD Studio Batch Audio Import

Create FMOD Studio events from a folder of audio files. Choose import settings in a dialog, or let filename suffixes determine how each sound behaves.

## Features

- Import `.wav`, `.mp3`, `.ogg`, `.aif`, `.aiff`, and `.flac` files.
- Create one event per file, or group variations into multi-instrument events.
- Choose 2D or 3D playback, one-shot or looping, and action sheets or timelines.
- Use filename suffixes for mixed batches, including scatterer events.
- Preserve source subfolders as event folders, with scanning up to 10 levels deep.
- Preview proposed event names and settings before importing.
- Skip, rename, or replace events that already exist in the same folder.

## Installation

1. Download [synnys_fmod_batch_import_options.js](synnys_fmod_batch_import_options.js). Use GitHub's **Download raw file** button to save the JavaScript file.
2. Place it in one of these locations:

   | Scope | Location |
   |---|---|
   | Current project | A `Scripts` folder beside your `.fspro` file |
   | Windows user | `%localappdata%/FMOD Studio/Scripts/` |
   | macOS user | `~/Library/Preferences/FMOD Studio/Scripts/` |
   | Linux user | `~/.config/fmod-studio/Scripts/` |

3. In FMOD Studio, choose **Scripts → Reload**.
4. Open **SynnyS Batch Import With Options** from the Scripts menu. Depending on how FMOD presents the registered menu path, it may appear inside a nested **Scripts** submenu.

To update, replace the installed file and reload scripts again.

## Quick start

1. Choose the folder containing your audio files.
2. Set **Import method** to **Choose settings**.
3. Choose:
   - **Create:** An event for each file (Single)
   - **Sound placement:** 2D
   - **Playback:** Play once
   - **Event sheet:** Action sheet
4. Leave **Existing events** on **Skip existing**, or select another policy.
5. Click **Preview** to inspect the proposed names and settings.
6. Click **Import**. The dialog displays the results and detailed log.

For example, `button_click.wav` becomes an event named `button_click`. No special suffixes are needed.

## Import methods

### Choose settings

Apply the same settings to the batch. Filenames are treated literally, with their extensions removed for single-event names. Text such as `_3d` or `_loop` has no special meaning in this mode.

| Setting | Options and behavior |
|---|---|
| **Create** | **Single:** one event per file. **Multi:** one variation event per source folder, containing the audio files directly in that folder. |
| **Sound placement** | **2D:** no spatializer added. **3D:** adds an FMOD spatializer. |
| **Playback** | **Play once** or **Loop**. Looping uses a timeline loop region. |
| **Event sheet** | **Action sheet** for playback on trigger, or **Timeline** for timed arrangement. Looping automatically uses a timeline. |

Manual multi events take their names from their source folders. Files in subfolders form separate groups; they are not combined with files in the parent folder.

For example, selecting a folder named `Footsteps` containing `gravel_a.wav` and `gravel_b.wav` creates one multi-instrument event named `Footsteps`.

### Use filename suffixes

Use this mode when different files need different playback settings. The manual instrument, placement, and playback controls are hidden because filenames determine those settings. The event-sheet choice still applies, except that loop and scatterer events always use timelines.

Add suffixes before the file extension:

- **No suffix:** creates a single 2D, one-shot event. `door_open.wav` becomes `door_open`.
- **`_3d`:** adds a spatializer. `door_open_3d.wav` becomes a 3D event named `door_open`.
- **`_loop`:** adds a timeline loop region. `wind_loop.wav` becomes a looping event named `wind`.
- **`_multi_N`:** groups numbered variations in the same folder into one multi-instrument event. `footsteps_multi_1.wav` and `footsteps_multi_2.wav` become `footsteps`.
- **`_scat_N`:** groups numbered variations into a scatterer event. `birds_scat_1.wav` and `birds_scat_2.wav` become `birds`. Scatterers are always 3D and use timelines.

Replace `N` with a variation number. Suffix matching is case-insensitive.

**Combining suffixes:**

```text
wind_3d_loop.wav
footsteps_multi_1_3d.wav
footsteps_multi_2_3d.wav
machine_multi_1_3d_loop.wav
machine_multi_2_3d_loop.wav
birds_scat_1_loop.wav
birds_scat_2_loop.wav
```

Place `_3d` and `_loop` **after** `_multi_N` or `_scat_N`, and use the same flags on every file in a group. The importer uses the first file's flags for the group; it does not reconcile conflicting flags.

For single files, recognized flags are removed from the event name. For grouped variations, the event name is the part before `_multi_N` or `_scat_N`. Reserve these patterns for import instructions when using suffix mode.

## Folder structure

Subfolders beneath the selected source folder become folders under FMOD's Events root. The selected source folder itself is not added as a parent event folder.

Example using **filename suffixes**:

```text
Selected source: my_sounds/
├── footsteps/
│   ├── footstep_multi_1.wav
│   └── footstep_multi_2.wav
├── ambient/
│   ├── wind_3d_loop.wav
│   ├── rain_scat_1.wav
│   └── rain_scat_2.wav
└── ui/
    └── button_click.wav

Created in FMOD Studio:
Events/
├── footsteps/
│   └── footstep       (Multi, 2 variations)
├── ambient/
│   ├── wind           (Single, 3D, looping timeline)
│   └── rain           (Scatterer, 3D, timeline)
└── ui/
    └── button_click   (Single, 2D)
```

## Existing events

Conflicts are checked by event name within the target event folder.

| Option | Behavior |
|---|---|
| **Skip existing** | Leaves existing events unchanged. This is the default. |
| **Create numbered copies** | Keeps the existing event and creates a new event with a numbered suffix, such as `Footstep_1`. |
| **Replace existing** | Deletes and recreates matching events. **Their GUIDs change**, which can break references. A confirmation appears before replacement. |

Replacement is not an in-place audio update. Use it only when recreating the event is intended.

## Preview and results

The importer shows proposed names, instrument types, sheet types, and 2D/3D settings in a scrollable preview. Counts are **before conflict handling**; skipped events can reduce the number created. Changing settings clears the previous preview.

After import, the same panel shows created, skipped, and failed counts, followed by detailed log entries. The importer does **not** automatically save a log file.

## Notes

- Run the script inside FMOD Studio, not as a standalone JavaScript program.
- The importer creates events; it does not assign them to banks or build banks. Assign the events to the appropriate banks afterward.
- Keep single-file basenames unique within each source folder. Files such as `hello.wav` and `hello.mp3` resolve to the same event name and are rejected as an ambiguous single-event group by the importer.
- Looping uses timeline regions, including for multi-instrument events. It does not configure each audio file to loop independently.
- A complete minimum-version compatibility matrix is not available. If an older FMOD Studio release reports scripting errors, check its bundled scripting documentation for supported UI and project APIs.
