import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class CaldavTasksPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings('org.gnome.shell.extensions.caldav-tasks');
        
        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({
            title: 'CalDAV Server Settings',
            description: 'Configure your CalDAV server connection'
        });
        page.add(group);

        // CalDAV URL
        const urlRow = new Adw.EntryRow({
            title: 'Server URL',
            text: settings.get_string('caldav-url')
        });
        urlRow.connect('changed', (widget) => {
            settings.set_string('caldav-url', widget.text);
        });
        group.add(urlRow);

        // Username
        const usernameRow = new Adw.EntryRow({
            title: 'Username',
            text: settings.get_string('caldav-username')
        });
        usernameRow.connect('changed', (widget) => {
            settings.set_string('caldav-username', widget.text);
        });
        group.add(usernameRow);

        // Password
        const passwordRow = new Adw.PasswordEntryRow({
            title: 'Password'
        });
        passwordRow.text = settings.get_string('caldav-password');
        passwordRow.connect('changed', (widget) => {
            settings.set_string('caldav-password', widget.text);
        });
        group.add(passwordRow);

        window.add(page);
    }
}