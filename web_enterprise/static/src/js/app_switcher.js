odoo.define('web_enterprise.AppSwitcher', function (require) {
"use strict";

var config = require('web.config');
var core = require('web.core');
var Widget = require('web.Widget');
var Model = require('web.Model');
var utils = require('web.utils');

var QWeb = core.qweb;
var NBR_ICONS = 6;

function visit(tree, callback, path) {
    path = path || [];
    callback(tree, path);
    _.each(tree.children, function(node) {
        visit(node, callback, path.concat(tree));
    });
}

function is_mobile() {
    return config.device.size_class <= config.device.SIZES.XS;
}

var AppSwitcher = Widget.extend({
    template: 'AppSwitcher',
    events: {
        'input input': function(e) {
            if(!e.target.value) {
                this.state = this.get_initial_state();
                this.state.is_searching = true;
            }
            this.update(e.target.value);
        },
    },
    init: function (parent, menu_data) {
        this._super.apply(this, arguments);
        this.menu_data = this.process_menu_data(menu_data);
        this.state = this.get_initial_state();
    },
    start: function () {
        this.$input = this.$('input');
        this.$menu_search = this.$('.o_menu_search');
        this.$main_content = this.$('.o_application_switcher_scrollable');
    },
    get_initial_state: function () {
        return {
            apps: _.where(this.menu_data, {is_app: true}),
            menu_items: [],
            focus: null,  // index of focused element
            is_searching: is_mobile(),
        };
    },
    process_menu_data: function(menu_data) {
        var result = [];
        visit(menu_data, function (menu_item, parents) {
            if (!menu_item.id || !menu_item.action) {
                return;
            }
            var item = {
                label: _.pluck(parents.slice(1), 'name').concat(menu_item.name).join(' / '),
                id: menu_item.id,
                action: menu_item.action ? menu_item.action.split(',')[1] : '',
                is_app: !menu_item.parent_id,
            };
            if (!menu_item.parent_id) {
                if (menu_item.web_icon_data) {
                    item.icon = 'data:image/png;base64,' + menu_item.web_icon_data;
                } else {
                    item.icon = '/web_enterprise/static/src/img/default_icon_app.png';
                }
            } else {
                item.menu_id = parents[1].id;
            }
            result.push(item);
        });
        return result;
    },
    on_attach_callback: function () {
        core.bus.on("keydown", this, this.on_keydown);
        this.state = this.get_initial_state();
        this.$input.val('');
        this.render();
    },
    on_detach_callback: function () {
        core.bus.off("keydown", this, this.on_keydown);
    },
    get_app_index: function () {
        return this.state.focus < this.state.apps.length ? this.state.focus : null;
    },
    get_menu_index: function () {
        var state = this.state;
        return state.focus >= state.apps.length ? state.focus - state.apps.length : null;
    },
    on_keydown: function(event) {
        var is_editable = event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA" || event.target.isContentEditable;
        if (is_editable && event.target !== this.$input[0]) {
            return;
        }
        var state = this.state;
        var elem_focused = state.focus !== null;
        var app_focused = elem_focused && state.focus < state.apps.length;
        var delta = app_focused ? NBR_ICONS : 1;
        var $input = this.$input;
        switch (event.which) {
            case $.ui.keyCode.DOWN:
                if (elem_focused) {
                    this.update_index(delta);
                } else {
                    this.state.focus = 0;
                }
                event.preventDefault();
                this.render();
                break;
            case $.ui.keyCode.RIGHT:
                if ($input.is(':focus') && $input[0].selectionEnd < $input.val().length) {
                    return;
                }
                if (elem_focused) {
                    this.update_index(1);
                } else {
                    this.state.focus = 0;
                }
                this.render();
                break;
            case $.ui.keyCode.TAB:
                event.preventDefault();
                this.update_index(1);
                this.render();
                break;
            case $.ui.keyCode.UP:
                if (elem_focused) {
                    this.update_index(-delta);
                } else {
                    this.state.focus = 0;
                }
                event.preventDefault();
                this.render();
                break;
            case $.ui.keyCode.LEFT:
                if ($input.is(':focus') && $input[0].selectionStart > 0) {
                    return;
                }
                if (elem_focused) {
                    this.update_index(-1);
                } else {
                    this.state.focus = 0;
                }
                this.render();
                break;
            case $.ui.keyCode.ENTER:
                if (elem_focused && this.state.focus < this.state.apps.length) {
                    var focused_app = this.state.apps[this.state.focus];
                    this.trigger_up('app_clicked', {
                        menu_id: focused_app.id,
                        action_id: focused_app.action,
                    });
                } else if (elem_focused) {
                    var index = this.state.focus - this.state.apps.length;
                    var menu = this.state.menu_items[index];
                    this.trigger_up('menu_clicked', {
                        menu_id: menu.id,
                        action_id: menu.action,
                    });
                    core.bus.trigger('change_menu_section', menu.menu_id);
                }
                event.preventDefault();
                return;
            case $.ui.keyCode.PAGE_DOWN:
            case $.ui.keyCode.PAGE_UP:
                break;
            default:
                if (!this.$input.is(':focus')) {
                    this.$input.focus();
                }
                this.state.focus = 0;
        }
    },
    update_index: function(delta) {
        var state = this.state;
        var app_nbr = state.apps.length;
        var new_index = state.focus + delta;
        if (new_index < 0) {
            new_index = state.apps.length + state.menu_items.length - 1;
        }
        if (new_index >= state.apps.length + state.menu_items.length) {
            new_index = 0;
        }
        if (new_index >= app_nbr && state.focus < app_nbr && delta > 0) {
            if (state.focus + delta - (state.focus % delta) < app_nbr) {
                new_index = app_nbr - 1;
            } else {
                new_index = app_nbr;
            }
        }
        if (new_index < app_nbr && state.focus >= app_nbr && delta < 0) {
            new_index = app_nbr - (app_nbr % NBR_ICONS);
            if (new_index === app_nbr) {
                new_index = app_nbr - NBR_ICONS;
            }
        }
        state.focus = new_index;
    },
    update: function(search) {
        var self = this;
        if (search) {
            var options = {extract: function(el) { return el.label; }};
            var search_results = fuzzy.filter(search, this.menu_data, options);
            var results = _.map(search_results, function (result) {
                return self.menu_data[result.index];
            });
            this.state = _.extend(this.state, {
                apps: _.where(results, {is_app: true}),
                menu_items: _.where(results, {is_app: false}),
                focus: results.length ? 0 : null,
                is_searching: true,
            });
        }
        this.render();
    },
    render: function() {
        this.$menu_search.toggleClass('o_bar_hidden', !this.state.is_searching);
        this.$main_content.html(QWeb.render('AppSwitcher.Content', { widget: this }));
        var $focused = this.$main_content.find('.o_focused');
        if ($focused.length && !is_mobile()) {
            $focused.focus();
            this.$el.scrollTo($focused, {offset: {top:-0.5*this.$el.height()}});
        }
        if (this.state.is_searching) {
            this.$el.css({
                "align-items": "flex-start",
                "padding-left": (window.innerWidth - this.$menu_search.width()) / 2
            });
        }
    },
});

return AppSwitcher;

});

odoo.define('web_enterprise.ExpirationPanel', function (require) {
"use strict";

var core = require('web.core');
var Model = require('web.Model');
var utils = require('web.utils');
var AppSwitcher = require('web_enterprise.AppSwitcher');

var QWeb = core.qweb;

AppSwitcher.include({
    events: _.extend(AppSwitcher.prototype.events, {
        'click .oe_instance_buy': 'enterprise_buy',
        'click .oe_instance_renew': 'enterprise_renew',
        'click .oe_instance_upsell': 'enterprise_upsell',
        'click a.oe_instance_register_show': function() {
            this.$('.oe_instance_register_form').slideToggle();
        },
        'click #confirm_enterprise_code': 'enterprise_code_submit',
        'click .oe_instance_hide_panel': 'enterprise_hide_panel',
    }),
    start: function () {
        this._super();
        this.enterprise_expiration_check();
    },
    /** Checks for the database expiration date and display a warning accordingly. */
    enterprise_expiration_check: function() {
        var self = this;
        if (!self.session) {
            return;
        }
        var P = new Model('ir.config_parameter');
        if (!odoo.db_info) {
            $.when(
                this.session.user_has_group('base.group_user'),
                this.session.user_has_group('base.group_system'),
                P.call('get_param', ['database.expiration_date']),
                P.call('get_param', ['database.enterprise_code']),
                P.call('get_param', ['database.expiration_reason'])
            ).then(function(is_user, is_admin, dbexpiration_date, dbenterprise_code, dbexpiration_reason) {
                // don't show the expiration warning for portal users
                if (!is_user) {
                    return;
                }
                var today = new moment();
                // if no date found, assume 1 month and hope for the best
                dbexpiration_date = new moment(dbexpiration_date || new moment().add(30, 'd'));
                var duration = moment.duration(dbexpiration_date.diff(today));
                var options = {
                    'diffDays': Math.round(duration.asDays()),
                    'dbexpiration_reason': dbexpiration_reason,
                    'warning': is_admin?'admin':(is_user?'user':false),
                    'dbenterprise_code': dbenterprise_code
                };
                self.enterprise_show_panel(options);
            });
        } else {
            $.when(
                P.call('get_param', ['database.enterprise_code'])
            ).then(function(dbenterprise_code) {
                // don't show the expiration warning for portal users
                if (!(odoo.db_info.warning))  {
                    return;
                }
                var today = new moment();
                // if no date found, assume 1 month and hope for the best
                var dbexpiration_date = new moment(odoo.db_info.expiration_date || new moment().add(30, 'd'));
                var duration = moment.duration(dbexpiration_date.diff(today));
                var options = {
                    'diffDays': Math.round(duration.asDays()),
                    'dbexpiration_reason': odoo.db_info.expiration_reason,
                    'warning': odoo.db_info.warning,
                    'dbenterprise_code': dbenterprise_code
                };
                self.enterprise_show_panel(options);
            });
        }
    },
    enterprise_show_panel: function(options) {
        //Show expiration panel 30 days before the expiry
        var self = this;
        var hide_cookie = utils.get_cookie('oe_instance_hide_panel');
        if ((options.diffDays <= 30 && !hide_cookie) || options.diffDays <= 0) {

            var expiration_panel = $(QWeb.render('WebClient.database_expiration_panel', {
                has_mail: _.includes(odoo._modules, 'mail'),
                diffDays: options.diffDays,
                dbenterprise_code:options.dbenterprise_code,
                dbexpiration_reason:options.dbexpiration_reason,
                warning: options.warning
            })).insertBefore(self.$menu_search);

            if (options.diffDays <= 0) {
                expiration_panel.children().addClass('alert-danger');
                expiration_panel.find('a.oe_instance_register_show').on('click.widget_events', self.events['click a.oe_instance_register_show']);
                expiration_panel.find('.oe_instance_buy').on('click.widget_events', self.proxy('enterprise_buy'));
                expiration_panel.find('.oe_instance_renew').on('click.widget_events', self.proxy('enterprise_renew'));
                expiration_panel.find('.oe_instance_upsell').on('click.widget_events', self.proxy('enterprise_upsell'));
                expiration_panel.find('#confirm_enterprise_code').on('click.widget_events', self.proxy('enterprise_code_submit'));
                expiration_panel.find('.oe_instance_hide_panel').hide();
                $.blockUI({message: expiration_panel.find('.database_expiration_panel')[0],
                           css: { cursor : 'auto' },
                           overlayCSS: { cursor : 'auto' } });
            }
        }
    },
    enterprise_hide_panel: function(ev) {
        ev.preventDefault();
        utils.set_cookie('oe_instance_hide_panel', true, 24*60*60);
        $('.database_expiration_panel').hide();
    },
    /** Save the registration code then triggers a ping to submit it*/
    enterprise_code_submit: function(ev) {
        ev.preventDefault();
        var enterprise_code = $('.database_expiration_panel').find('#enterprise_code').val();
        if (!enterprise_code) {
            var $c = $('#enterprise_code');
            $c.attr('placeholder', $c.attr('title')); // raise attention to input
            return;
        }
        var P = new Model('ir.config_parameter');
        var Publisher = new Model('publisher_warranty.contract');
        $.when(
            P.call('get_param', ['database.expiration_date']),
            P.call('set_param', ['database.enterprise_code', enterprise_code]))
        .then(function(old_date) {
            utils.set_cookie('oe_instance_hide_panel', '', -1);
            Publisher.call('update_notification', [[]]).then(function() {
                $.unblockUI();
                $.when(
                    P.call('get_param', ['database.expiration_date']),
                    P.call('get_param', ['database.expiration_reason']))
                .then(function(dbexpiration_date) {
                    $('.oe_instance_register').hide();
                    $('.database_expiration_panel .alert').removeClass('alert-info alert-warning alert-danger');
                    if (dbexpiration_date !== old_date) {
                        $('.oe_instance_hide_panel').show();
                        $('.database_expiration_panel .alert').addClass('alert-success');
                        $('.valid_date').html(moment(dbexpiration_date).format('LL'));
                        $('.oe_instance_success').show();
                    } else {
                        $('.database_expiration_panel .alert').addClass('alert-danger');
                        $('.oe_instance_error, .oe_instance_register_form').show();
                        $('#confirm_enterprise_code').html('Retry');
                    }
                });
            });
        });
    },
    enterprise_buy: function() {
        var limit_date = new moment().subtract(15, 'days').format("YYYY-MM-DD");
        new Model("res.users").call("search_count", [[["share", "=", false],["login_date", ">=", limit_date]]]).then(function(users) {
            window.location = $.param.querystring("https://www.odoo.com/odoo-enterprise/upgrade", {num_users: users});
        });
    },
    enterprise_renew: function() {
        new Model('ir.config_parameter').call('get_param', ['database.enterprise_code']).then(function(contract) {
            var params = contract ? {contract: contract} : {};
            window.location = $.param.querystring("https://www.odoo.com/odoo-enterprise/renew", params);
        });
    },
    enterprise_upsell: function() {
        var limit_date = new moment().subtract(15, 'days').format("YYYY-MM-DD");
        new Model('ir.config_parameter').call('get_param', ['database.enterprise_code']).then(function(contract) {
            new Model("res.users").call("search_count", [[["share", "=", false],["login_date", ">=", limit_date]]]).then(function(users) {
                var params = contract ? {contract: contract, num_users: users} : {num_users: users};
                window.location = $.param.querystring("https://www.odoo.com/odoo-enterprise/upsell", params);
            });
        });
    },
});

});
