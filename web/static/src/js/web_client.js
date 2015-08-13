odoo.define('web.WebClient', function (require) {
"use strict";

var ActionManager = require('web.ActionManager');
var config = require('web.config');
var core = require('web.core');
var crash_manager = require('web.crash_manager');
var data = require('web.data');
var framework = require('web.framework');
var Loading = require('web.Loading');
var AppSwitcher = require('web.AppSwitcher');
var Menu = require('web.Menu');
var Model = require('web.DataModel');
var NotificationManager = require('web.notification').NotificationManager;
var session = require('web.session');
var utils = require('web.utils');
var Widget = require('web.Widget');

var QWeb = core.qweb;
var _t = core._t;

var WebClient = Widget.extend({
    custom_events: {
        'app_clicked': 'on_app_clicked',
        'menu_clicked': 'on_menu_clicked',
        'scrollTo': 'scrollTo',
        'show_app_switcher': function () {
            this.toggle_app_switcher(true);
        },
        'hide_app_switcher': function () {
            // Restore the url
            $.bbq.pushState(this.url);
            this.toggle_app_switcher(false);
        },
        'notification': function (e) {
            if(this.notification_manager) {
                this.notification_manager.notify(e.data.title, e.data.message, e.data.sticky);
            }
        },
        'warning': function (e) {
            if(this.notification_manager) {
                this.notification_manager.warn(e.data.title, e.data.message, e.data.sticky);
            }
        },
    },
    init: function(parent, client_options) {
        this.client_options = {};
        this._super(parent);
        this.origin = undefined;
        if (client_options) {
            _.extend(this.client_options, client_options);
        }
        this._current_state = null;
        this.menu_dm = new utils.DropMisordered();
        this.action_mutex = new utils.Mutex();
        this.set('title_part', {"zopenerp": "Odoo"});
    },
    start: function() {
        var self = this;
        this.on("change:title_part", this, this._title_changed);
        this._title_changed();
        this.$el.toggleClass('o_touch_device', config.device.touch);

        return session.session_bind(this.origin).then(function () {
            self.bind_events();
            return self.show_common();
        }).then(function () {
            if (session.session_is_valid()) {
                return self.show_application();
            } else {
                // database manager needs the webclient to keep going even
                // though it has no valid session
                return $.when();
            }
        }).then(function () {
            if (self.client_options.action) {
                self.do_action(self.client_options.action);
                delete(self.client_options.action);
            }
            core.bus.trigger('web_client_ready');
        });
    },
    bind_events: function() {
        var self = this;
        $('.oe_systray').show();
        this.$el.on('mouseenter', '.oe_systray > div:not([data-toggle=tooltip])', function() {
            $(this).attr('data-toggle', 'tooltip').tooltip().trigger('mouseenter');
        });
        this.$el.on('click', '.oe_dropdown_toggle', function(ev) {
            ev.preventDefault();
            var $toggle = $(this);
            var doc_width = $(document).width();
            var $menu = $toggle.siblings('.oe_dropdown_menu');
            $menu = $menu.size() >= 1 ? $menu : $toggle.find('.oe_dropdown_menu');
            var state = $menu.is('.oe_opened');
            setTimeout(function() {
                // Do not alter propagation
                $toggle.add($menu).toggleClass('oe_opened', !state);
                if (!state) {
                    // Move $menu if outside window's edge
                    var offset = $menu.offset();
                    var menu_width = $menu.width();
                    var x = doc_width - offset.left - menu_width - 2;
                    if (x < 0) {
                        $menu.offset({ left: offset.left + x }).width(menu_width);
                    }
                }
            }, 0);
        });
        core.bus.on('click', this, function(ev) {
            $('.tooltip').remove();
            if (!$(ev.target).is('input[type=file]')) {
                self.$('.oe_dropdown_menu.oe_opened, .oe_dropdown_toggle.oe_opened').removeClass('oe_opened');
            }
        });
        core.bus.on('set_full_screen', this, function (full_screen) {
            this.set_content_full_screen(full_screen);
        });

        core.bus.on('connection_lost', this, this.on_connection_lost);
        core.bus.on('connection_restored', this, this.on_connection_restored);

        // Fastclick
        if ('addEventListener' in document) {
            document.addEventListener('DOMContentLoaded', function() {
                FastClick.attach(document.body);
            }, false);
        }
    },
    show_common: function() {
        var self = this;

        // crash manahger integration
        session.on('error', crash_manager, crash_manager.rpc_error);
        window.onerror = function (message, file, line, col, error) {
            var traceback = error ? error.stack : '';
            crash_manager.show_error({
                type: _t("Client Error"),
                message: message,
                data: {debug: file + ':' + line + "\n" + _t('Traceback:') + "\n" + traceback}
            });
        };

        // common widgets insertion
        this.action_manager = new ActionManager(this, {webclient: this});
        this.notification_manager = new NotificationManager(this);
        this.loading = new Loading(this);

        var defs = [];
        defs.push(this.action_manager.appendTo(this.$el));
        defs.push(this.notification_manager.appendTo(this.$el));
        defs.push(this.loading.appendTo(this.$el));

        return $.when.apply($, defs);
    },
    clear_uncommitted_changes: function() {
        var def = $.Deferred().resolve();
        core.bus.trigger('clear_uncommitted_changes', function chain_callbacks(callback) {
            def = def.then(callback);
        });
        return def;
    },
    /**
        Sets the first part of the title of the window, dedicated to the current action.
    */
    set_title: function(title) {
        this.set_title_part("action", title);
    },
    /**
        Sets an arbitrary part of the title of the window. Title parts are identified by strings. Each time
        a title part is changed, all parts are gathered, ordered by alphabetical order and displayed in the
        title of the window separated by '-'.
    */
    set_title_part: function(part, title) {
        var tmp = _.clone(this.get("title_part"));
        tmp[part] = title;
        this.set("title_part", tmp);
    },
    _title_changed: function() {
        var parts = _.sortBy(_.keys(this.get("title_part")), function(x) { return x; });
        var tmp = "";
        _.each(parts, function(part) {
            var str = this.get("title_part")[part];
            if (str) {
                tmp = tmp ? tmp + " - " + str : str;
            }
        }, this);
        document.title = tmp;
    },
    show_application: function () {
        var self = this;
        this.set_title();

        var Menus = new Model('ir.ui.menu');
        return Menus.call('load_menus', {context: session.user_context}).then(function(menu_data) {
            // Here, we instanciate every menu widgets and we immediately append them into dummy
            // document fragments, so that their `start` method are executed before inserting them
            // into the DOM.
            self.app_switcher = new AppSwitcher.AppSwitcher(self, menu_data);
            self.app_switcher_navbar = new AppSwitcher.AppSwitcherNavbar(self);
            self.menu = new Menu(self, menu_data);

            var defs = [];
            defs.push(self.app_switcher.appendTo(document.createDocumentFragment()));
            defs.push(self.app_switcher_navbar.appendTo(document.createDocumentFragment()));
            defs.push(self.menu.appendTo(document.createDocumentFragment()));
            return $.when.apply($, defs);
        }).then(function () {
            $(window).bind('hashchange', self.on_hashchange);

            // Unclean: if the url's state is empty we display the app switcher, if not we trigger
            // a dummy haschange event so that `self.on_hashchange` will take care of toggling the
            // app switcher and load the action.
            if (_.isEmpty($.bbq.getState(true))) {
                self.toggle_app_switcher(true);
            } else {
                $(window).trigger('hashchange');
            }
        });
    },
    // --------------------------------------------------------------
    // do_*
    // --------------------------------------------------------------
    /**
     * When do_action is performed on the WebClient, forward it to the main ActionManager
     * This allows to widgets that are not inside the ActionManager to perform do_action
     */
    do_action: function() {
        return this.action_manager.do_action.apply(this, arguments);
    },
    destroy_content: function() {
        _.each(_.clone(this.getChildren()), function(el) {
            el.destroy();
        });
        this.$el.children().remove();
    },
    do_reload: function() {
        var self = this;
        return this.session.session_reload().then(function () {
            session.load_modules(true).then(
                self.menu.proxy('do_reload')); });
    },
    do_push_state: function(state) {
        this.set_title(state.title);
        delete state.title;
        var url = '#' + $.param(state);
        this._current_state = $.deparam($.param(state), false);     // stringify all values
        $.bbq.pushState(url);
        this.trigger('state_pushed', state);
    },
    // --------------------------------------------------------------
    // URL state handling
    // --------------------------------------------------------------
    on_hashchange: function(event) {
        if (!this._ignore_hashchange) {
            var self = this;
            var stringstate = event.getState(false);
            if (!_.isEqual(this._current_state, stringstate)) {
                var state = event.getState(true);
                if (!state.action && state.menu_id) {
                    var action_id = self.menu.menu_id_to_action_id(state.menu_id);
                    self.do_action(action_id, {clear_breadcrumbs: true}).then(update_menu);
                } else if (state.action) {
                    state._push_me = false;  // no need to push state back...
                    self.action_manager.do_load_state(state, !!this._current_state).then(update_menu);
                } else {
                    self.toggle_app_switcher(true);
                }
            }
            this._current_state = stringstate;
        }
        this._ignore_hashchange = false;

        function update_menu() {
            var action = self.action_manager.get_inner_action();
            if (action) {
                var menu_id = self.menu.action_id_to_primary_menu_id(action.get_action_descr().id);
                if (menu_id) {
                    core.bus.trigger('change_menu_section', menu_id);
                }
            }
            self.toggle_app_switcher(false);
        }
    },
    // --------------------------------------------------------------
    // Menu handling
    // --------------------------------------------------------------
    on_app_clicked: function (ev) {
        var self = this;
        return this.menu_dm.add(this.rpc("/web/action/load", {action_id: ev.data.action_id}))
            .then(function (result) {
                return self.action_mutex.exec(function () {
                    var completed = $.Deferred();
                    $.when(self.do_action(result, {
                        clear_breadcrumbs: true,
                        action_menu_id: ev.data.menu_id,
                    })).fail(function () {
                        self.toggle_app_switcher(true);
                        completed.resolve();
                    }).done(function () {
                        core.bus.trigger('change_menu_section', ev.data.menu_id);
                        self.toggle_app_switcher(false);
                        completed.resolve();
                    });

                    setTimeout(function () {
                        completed.resolve();
                    }, 2000);

                    return completed;
                });
            });
    },
    on_menu_clicked: function (ev) {
        var self = this;
        return this.menu_dm.add(this.rpc("/web/action/load", {action_id: ev.data.action_id}))
            .then(function (result) {
                return self.action_mutex.exec(function () {
                    var completed = $.Deferred();
                    $.when(self.do_action(result, {
                        clear_breadcrumbs: true,
                        action_menu_id: ev.data.menu_id,
                    })).fail(function () {
                        self.toggle_app_switcher(true);
                    }).always(function () {
                        completed.resolve();
                    });

                    setTimeout(function () {
                        completed.resolve();
                    }, 2000);

                    return completed;
                });
            });
    },
    toggle_app_switcher: function (display) {
        if (display) {
            var self = this;
            this.clear_uncommitted_changes().then(function() {
                // Save the current scroll position of the action_manager
                self.action_manager.set_scrollTop(self.get_scrollTop());
                self.menu.$el.detach();
                self.$web_client_content = self.$el.contents()
                                                .not('.o_loading')
                                                .not('.ui-autocomplete')
                                                .detach();
                self.action_manager.set_is_in_DOM(false);
                self.app_switcher.$el.prependTo(self.$el);
                self.app_switcher_navbar.$el.prependTo(self.$el);
                self.app_switcher_navbar.toggle_back_button(self.action_manager.get_inner_action() === null);
                // Save and clear the url
                self.url = $.bbq.getState();
                self._ignore_hashchange = true;
                $.bbq.removeState();
            });
        } else if (display === false) {
            this.app_switcher.$el.detach();
            this.app_switcher_navbar.$el.detach();
            framework.prepend(this.$el, [this.menu.$el, this.$web_client_content], true);
            this.action_manager.set_is_in_DOM(true);
        }
    },
    // --------------------------------------------------------------
    // Connection notification
    // --------------------------------------------------------------
    on_connection_lost: function () {
        this.connection_notification = this.notification_manager.notify(
            _t('Connection lost'),
            _t('Trying to reconnect...'),
            true
        );
    },
    on_connection_restored: function () {
        if (this.connection_notification) {
            this.connection_notification.destroy();
            this.notification_manager.notify(
                _t('Connection restored'),
                _t('You are back online'),
                false
            );
            this.connection_notification = false;
        }
    },
    // --------------------------------------------------------------
    // Scrolltop handling
    // --------------------------------------------------------------
    get_scrollTop: function () {
        if (config.device.xs) {
            return this.el.scrollTop;
        } else {
            return this.action_manager.el.scrollTop;
        }
    },
    /**
     * Scrolls the webclient to either a given offset or a target element
     * Must be called with: trigger_up('scrollTo', options)
     * @param {Integer} [options.offset] the number of pixels to scroll from top
     * @param {Integer} [options.offset_left] the number of pixels to scroll from left
     * @param {String} [options.selector] the selector of the target element to scroll to
     */
    scrollTo: function (ev) {
        var offset = {top: ev.data.offset, left: ev.data.offset_left || 0};
        var xs_device = config.device.xs;
        if (!offset.top) {
            offset = framework.getPosition(document.querySelector(ev.data.selector));
            if (!xs_device) {
                // Substract the position of the action_manager as it is the scrolling part
                offset.top -= framework.getPosition(this.action_manager.el).top;
            }
        }
        if (xs_device) {
            this.el.scrollTop = offset.top;
        } else {
            this.action_manager.el.scrollTop = offset.top;
        }
        this.action_manager.el.scrollLeft = offset.left;
    },
    // --------------------------------------------------------------
    // Misc.
    // --------------------------------------------------------------
    set_content_full_screen: function(fullscreen) {
        $(document.body).css('overflow-y', fullscreen ? 'hidden' : 'scroll');
        this.$('.oe_webclient').toggleClass(
            'oe_content_full_screen', fullscreen);
    },
});

return WebClient;

});
