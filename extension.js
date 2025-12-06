import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import Soup from 'gi://Soup';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

export default class CaldavTasksExtension extends Extension {
    enable() {
        this._settings = this.getSettings('org.gnome.shell.extensions.caldav-tasks');
        this._cachedTasks = [];
        this._allCalendars = [];
        this._selectedCalendarUrl = null;
        this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);

        let icon = new St.Icon({
            icon_name: 'view-list-symbolic',
            style_class: 'system-status-icon',
            icon_size: 20
        });
        this._indicator.add_child(icon);

        // Calendar selector dropdown
        this._calendarSelector = new PopupMenu.PopupSubMenuMenuItem('All Calendars', true);
        this._calendarSelector.icon.icon_name = 'view-list-symbolic';
        this._indicator.menu.addMenuItem(this._calendarSelector);

        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Scrollable task list
        this._menuSection = new PopupMenu.PopupMenuSection();
        let scrollView = new St.ScrollView({
            style_class: 'task-list-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true
        });
        scrollView.add_child(this._menuSection.actor);
        scrollView.set_style('width: 600px; height: 300px;');
        
        let scrollItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false
        });
        scrollItem.actor.set_style('width: 600px;');
        scrollItem.add_child(scrollView);
        this._indicator.menu.addMenuItem(scrollItem);

        this._indicator.menu.box.set_style('width: 600px;');

        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Task input section
        let inputItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'add-task-input-item'
        });

        this._taskEntry = new St.Entry({
            style_class: 'add-task-entry',
            can_focus: true,
            hint_text: 'New task...',
            x_expand: true
        });

        let addButton = new St.Button({
            label: 'Add',
            style_class: 'add-task-button',
            can_focus: true
        });

        addButton.connect('clicked', async () => {
            let summary = this._taskEntry.get_text().trim();
            if (summary) {
                await this._createTask(summary);
                this._taskEntry.set_text('');
                await this._refreshTasks();
            }
        });

        this._taskEntry.clutter_text.connect('activate', async () => {
            let summary = this._taskEntry.get_text().trim();
            if (summary) {
                await this._createTask(summary);
                this._taskEntry.set_text('');
                await this._refreshTasks();
            }
        });

        inputItem.add_child(this._taskEntry);
        inputItem.add_child(addButton);
        this._indicator.menu.addMenuItem(inputItem);

        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Refresh button
        let refreshItem = new PopupMenu.PopupMenuItem('Refresh');
        refreshItem.connect('activate', () => this._refreshTasks());
        this._indicator.menu.addMenuItem(refreshItem);

        Main.panel.addToStatusArea(this.uuid, this._indicator);

        let themeContext = St.ThemeContext.get_for_stage(global.stage);
        themeContext.get_theme().load_stylesheet(
            Gio.File.new_for_path(this.path + '/stylesheet.css')
        );

        this._refreshTasks();
    }

    _populateCalendarSelector() {
        this._calendarSelector.menu.removeAll();
        
        let allItem = new PopupMenu.PopupMenuItem('All Calendars');
        allItem.connect('activate', () => {
            this._selectedCalendarUrl = null;
            this._calendarSelector.label.text = 'All Calendars';
            this._renderTasksFromCache();
            return Clutter.EVENT_STOP;
        });
        this._calendarSelector.menu.addMenuItem(allItem);
        
        for (let cal of this._allCalendars) {
            let calItem = new PopupMenu.PopupMenuItem(cal.name);
            calItem.connect('activate', () => {
                this._selectedCalendarUrl = cal.url;
                this._calendarSelector.label.text = cal.name;
                this._renderTasksFromCache();
                return Clutter.EVENT_STOP;
            });
            this._calendarSelector.menu.addMenuItem(calItem);
        }
    }

    _getCredentials() {
        return {
            url: this._settings.get_string('caldav-url'),
            username: this._settings.get_string('caldav-username'),
            password: this._settings.get_string('caldav-password')
        };
    }

    async _refreshTasks() {
        this._menuSection.removeAll();
        try {
            let creds = this._getCredentials();
            if (!creds.url || !creds.username || !creds.password) {
                this._menuSection.addMenuItem(new PopupMenu.PopupMenuItem('Configure server in settings'));
                return;
            }

            let session = new Soup.Session();
            let message = Soup.Message.new('PROPFIND', creds.url);
            let credentials = `${creds.username}:${creds.password}`;
            let authString = GLib.base64_encode(
                new TextEncoder().encode(credentials)
            );
            message.request_headers.append('Authorization', 'Basic ' + authString);
            message.request_headers.append('Depth', '1');
            message.request_headers.append('Content-Type', 'application/xml');
            
            let propfindBody = `<?xml version="1.0"?>
<propfind xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <prop>
    <resourcetype/>
    <displayname/>
    <C:supported-calendar-component-set/>
  </prop>
</propfind>`;
            message.set_request_body_from_bytes(
                'application/xml',
                new GLib.Bytes(new TextEncoder().encode(propfindBody))
            );

            let bytes = await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);

            if (message.status_code !== 207) {
                this._menuSection.addMenuItem(new PopupMenu.PopupMenuItem(`Error: HTTP ${message.status_code}`));
                return;
            }

            let decoder = new TextDecoder('utf-8');
            let data = decoder.decode(bytes.get_data());
            
            this._allCalendars = [];
            let responseRegex = /<response>([\s\S]*?)<\/response>/g;
            let match;
            
            while ((match = responseRegex.exec(data)) !== null) {
                let response = match[1];
                let hrefMatch = /<href>([^<]+)<\/href>/.exec(response);
                let displayNameMatch = /<displayname>([^<]+)<\/displayname>/.exec(response);

                if (hrefMatch && displayNameMatch && 
                    displayNameMatch[1] !== 'My Contacts') {
                    let href = hrefMatch[1];
                    let originMatch = creds.url.match(/^(https?:\/\/[^\/]+)/);
                    let origin = originMatch ? originMatch[1] : creds.url;
                    
                    this._allCalendars.push({
                        url: origin + href,
                        name: displayNameMatch[1]
                    });
                }
            }

            this._populateCalendarSelector();

            let allTasks = [];
            for (let cal of this._allCalendars) {
                let tasks = await this._getTasksFromCalendar(session, cal.url, authString);
                tasks.forEach(task => task.calendarUrl = cal.url);
                allTasks = allTasks.concat(tasks);
            }

            if (allTasks.length === 0) {
                this._menuSection.addMenuItem(new PopupMenu.PopupMenuItem('No tasks found'));
            } else {
                this._cachedTasks = allTasks;
                this._renderTasksFromCache();
            }
        } catch (e) {
            this._menuSection.addMenuItem(new PopupMenu.PopupMenuItem('Error: ' + e.message));
        }
    }

    _renderTasksFromCache() {
        this._menuSection.removeAll();
        
        let tasksToDisplay = this._cachedTasks;
        if (this._selectedCalendarUrl !== null) {
            tasksToDisplay = this._cachedTasks.filter(task => task.calendarUrl === this._selectedCalendarUrl);
        }
        
        if (tasksToDisplay.length === 0) {
            this._menuSection.addMenuItem(new PopupMenu.PopupMenuItem('No tasks found'));
            return;
        }
        
        for (let task of tasksToDisplay) {
            let item = new PopupMenu.PopupBaseMenuItem({ reactive: false });

            // Task completion circle
            let circle = new St.DrawingArea({
                width: 18,
                height: 18,
                style_class: 'task-circle',
                reactive: true,
                can_focus: true
            });

            circle.connect('repaint', (area) => {
                let cr = area.get_context();
                cr.arc(9, 9, 8, 0, 2 * Math.PI);
                if (task.completed) {
                    cr.setSourceRGBA(1, 0, 0, 1);
                    cr.fillPreserve();
                }
                cr.setSourceRGBA(1, 0, 0, 1);
                cr.setLineWidth(2);
                cr.stroke();
            });

            circle.connect('button-press-event', async () => {
                if (task.completed) {
                    await this._uncompleteTask(task);
                    task.completed = false;
                } else {
                    await this._completeTask(task);
                    task.completed = true;
                }
                this._renderTasksFromCache();
                return Clutter.EVENT_STOP;
            });

            item.add_child(circle);

            let label = new St.Label({ 
                text: task.summary,
                x_expand: true
            });
            if (task.completed) {
                label.add_style_class_name('task-completed');
            }
            item.add_child(label);

            if (task.due) {
                let dueDate = this._cleanDueDate(task.due);
                let dueBox = new St.Label({
                    text: dueDate,
                    style_class: 'due-date-box'
                });
                item.add_child(dueBox);
            }

            let deleteButton = new St.Button({
                label: '✕',
                style_class: 'delete-button',
                x_expand: false,
                x_align: Clutter.ActorAlign.END
            });

            deleteButton.connect('clicked', async () => {
                await this._deleteTask(task);
                this._cachedTasks = this._cachedTasks.filter(t => t.uid !== task.uid);
                this._renderTasksFromCache();
            });

            item.add_child(deleteButton);

            this._menuSection.addMenuItem(item);
        }
    }

    _cleanDueDate(dueString) {
        dueString = dueString.replace('VALUE=DATE:', '');
        dueString = dueString.replace(/^TZID=[^:]+:/, '');
        
        let dateMatch = dueString.match(/(\d{8})/);
        if (dateMatch) {
            let dateStr = dateMatch[1];
            let year = dateStr.substr(0, 4);
            let month = dateStr.substr(4, 2);
            let day = dateStr.substr(6, 2);
            return `${day}.${month}.${year}`;
        }
        
        return dueString;
    }

    async _getTasksFromCalendar(session, calendarUrl, authString) {
        let message = Soup.Message.new('REPORT', calendarUrl);
        message.request_headers.append('Authorization', 'Basic ' + authString);
        message.request_headers.append('Depth', '1');
        message.request_headers.append('Content-Type', 'application/xml');
        
        let reportBody = `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><D:getetag/><C:calendar-data/></D:prop>
  <C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VTODO"/></C:comp-filter></C:filter>
</C:calendar-query>`;
        
        message.set_request_body_from_bytes(
            'application/xml',
            new GLib.Bytes(new TextEncoder().encode(reportBody))
        );

        let bytes = await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
        
        if (message.status_code !== 207) return [];
        
        let decoder = new TextDecoder('utf-8');
        let data = decoder.decode(bytes.get_data());
        
        return this._parseTasks(data);
    }

    _parseTasks(data) {
        let tasks = [];
        let vcalendarRegex = /BEGIN:VCALENDAR([\s\S]*?END:VCALENDAR)/g;
        let hrefRegex = /<href>([^<]+)<\/href>/g;
        let hrefs = [];
        let match;
        while ((match = hrefRegex.exec(data)) !== null) {
            hrefs.push(match[1]);
        }
        let i = 0;
        while ((match = vcalendarRegex.exec(data)) !== null) {
            let vcal = match[0];
            let vtodoMatch = /BEGIN:VTODO([\s\S]*?)END:VTODO/.exec(vcal);
            let summaryMatch = /SUMMARY:([^\r\n]+)/.exec(vcal);
            let completedMatch = /STATUS:COMPLETED/.exec(vcal);
            let uidMatch = /UID:([^\r\n]+)/.exec(vcal);
            let dueMatch = /DUE[;:]([^\r\n]+)/.exec(vcal);
            if (summaryMatch && uidMatch && vtodoMatch) {
                tasks.push({
                    summary: summaryMatch[1],
                    completed: !!completedMatch,
                    uid: uidMatch[1],
                    due: dueMatch ? dueMatch[1] : null,
                    vcal: vcal,
                    vtodo: vtodoMatch[0],
                    href: hrefs[i] || '',
                });
            }
            i++;
        }
        return tasks;
    }

    async _completeTask(task) {
        let creds = this._getCredentials();
        let url = creds.url.replace(/\/$/, '') + task.href.replace(creds.url.replace(/\/$/, ''), '');
        let completedVtodo = task.vtodo
            .replace(/BEGIN:VTODO\r?\n/, '')
            .replace(/END:VTODO/, '')
            .replace(/STATUS:[^\r\n]*\r?\n?/g, '')
            .replace(/PERCENT-COMPLETE:[^\r\n]*\r?\n?/g, '')
            .replace(/COMPLETED:[^\r\n]*\r?\n?/g, '');
        
        let now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
        completedVtodo += `\r\nSTATUS:COMPLETED\r\nPERCENT-COMPLETE:100\r\nCOMPLETED:${now}`;
        
        let ical = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//GNOME Shell//EN\r\nBEGIN:VTODO\r\n${completedVtodo}\r\nEND:VTODO\r\nEND:VCALENDAR`;

        let session = new Soup.Session();
        let credentials = `${creds.username}:${creds.password}`;
        let authString = GLib.base64_encode(
            new TextEncoder().encode(credentials)
        );
        let message = Soup.Message.new('PUT', url);
        message.request_headers.append('Authorization', 'Basic ' + authString);
        message.request_headers.append('Content-Type', 'text/calendar');
        message.set_request_body_from_bytes(
            'text/calendar',
            new GLib.Bytes(new TextEncoder().encode(ical))
        );
        await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
    }

    async _uncompleteTask(task) {
        let creds = this._getCredentials();
        let url = creds.url.replace(/\/$/, '') + task.href.replace(creds.url.replace(/\/$/, ''), '');
        let uncompletedVtodo = task.vtodo
            .replace(/BEGIN:VTODO\r?\n/, '')
            .replace(/END:VTODO/, '')
            .replace(/STATUS:[^\r\n]*\r?\n?/g, '')
            .replace(/PERCENT-COMPLETE:[^\r\n]*\r?\n?/g, '')
            .replace(/COMPLETED:[^\r\n]*\r?\n?/g, '');
        
        uncompletedVtodo += `\r\nSTATUS:NEEDS-ACTION\r\nPERCENT-COMPLETE:0`;
        
        let ical = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//GNOME Shell//EN\r\nBEGIN:VTODO\r\n${uncompletedVtodo}\r\nEND:VTODO\r\nEND:VCALENDAR`;

        let session = new Soup.Session();
        let credentials = `${creds.username}:${creds.password}`;
        let authString = GLib.base64_encode(
            new TextEncoder().encode(credentials)
        );
        let message = new Soup.Message.new('PUT', url);
        message.request_headers.append('Authorization', 'Basic ' + authString);
        message.request_headers.append('Content-Type', 'text/calendar');
        message.set_request_body_from_bytes(
            'text/calendar',
            new GLib.Bytes(new TextEncoder().encode(ical))
        );
        await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
    }

    async _deleteTask(task) {
        let creds = this._getCredentials();
        let url = creds.url.replace(/\/$/, '') + task.href.replace(creds.url.replace(/\/$/, ''), '');
        let session = new Soup.Session();
        let credentials = `${creds.username}:${creds.password}`;
        let authString = GLib.base64_encode(
            new TextEncoder().encode(credentials)
        );
        let message = Soup.Message.new('DELETE', url);
        message.request_headers.append('Authorization', 'Basic ' + authString);
        await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
    }

    async _createTask(summary) {
        try {
            let creds = this._getCredentials();
            
            let targetCalendarUrl;
            if (this._selectedCalendarUrl !== null) {
                targetCalendarUrl = this._selectedCalendarUrl;
            } else {
                let inboxCal = this._allCalendars.find(cal => 
                    cal.name.toLowerCase() === 'inbox'
                );
                targetCalendarUrl = inboxCal ? inboxCal.url : this._allCalendars[0].url;
            }

            let uid = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}@gnome-shell`;
            let now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

            let ical = `BEGIN:VCALENDAR\r
VERSION:2.0\r
PRODID:-//GNOME Shell//EN\r
BEGIN:VTODO\r
UID:${uid}\r
DTSTAMP:${now}\r
SUMMARY:${summary}\r
STATUS:NEEDS-ACTION\r
PERCENT-COMPLETE:0\r
END:VTODO\r
END:VCALENDAR`;

            let session = new Soup.Session();
            let credentials = `${creds.username}:${creds.password}`;
            let authString = GLib.base64_encode(
                new TextEncoder().encode(credentials)
            );

            let url = `${targetCalendarUrl}${uid}.ics`;
            let message = Soup.Message.new('PUT', url);
            message.request_headers.append('Authorization', 'Basic ' + authString);
            message.request_headers.append('Content-Type', 'text/calendar');
            message.set_request_body_from_bytes(
                'text/calendar',
                new GLib.Bytes(new TextEncoder().encode(ical))
            );

            await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
        } catch (e) {
            log(`Error creating task: ${e.message}`);
        }
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        this._settings = null;
    }
}