# CalDAV Tasks GNOME Shell Extension

This extension was developed primarily for personal use and tested with EteSync running on localhost. Bugs are expected, and feedback or testing with other CalDAV servers is welcome!

<img width="1920" height="1200" alt="Screenshot From 2025-12-07 10-12-43" src="https://github.com/user-attachments/assets/23e7992f-cb24-4408-aa00-7468934e79f2" />

## Description

CalDAV Tasks adds a simple task manager to your GNOME Shell panel. It connects to your CalDAV server, lists your task calendars, and lets you view, add, complete, and delete tasks directly from the panel. You can filter tasks by calendar and see due dates if available.

## Logic Overview

- The extension connects to your CalDAV server using credentials you provide in the settings.
- It discovers available calendars by parsing the CalDAV server’s response.
- For each calendar, it queries for VTODO items (tasks) and displays them in a scrollable list.
- You can mark tasks as complete/incomplete, add new tasks, or delete them.
- The extension uses regular expressions to parse calendar and task data, aiming for compatibility with most CalDAV servers, but only tested with EteSync so far.

## Notes

- Developed for GNOME Shell 45+.
- Only tested with EteSync (localhost).
- Bugs and incompatibilities with other CalDAV servers are possible.
- Contributions and testing with other servers are very welcome!

## How to Use

1. Install the extension.
2. Open the settings and enter your CalDAV server URL, username, and password.
3. Use the panel menu to manage your tasks.

## Support

This project is a small personal effort, but any incentive will help keep me going!  
If you find it useful, consider [buying me a coffee](https://buymeacoffee.com/pmetis) ☕. Thank you!

## Contributing

If you test with another CalDAV server, please open an issue or pull request with your findings!
