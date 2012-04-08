/* -*0 mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -* */

/* CoverflowAltTab::Switcher:
 *
 * The implementation of the switcher UI. Handles keyboard events.
 */

const Lang = imports.lang;

const Clutter = imports.gi.Clutter;
const St = imports.gi.St;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;

const AltTab = imports.ui.altTab;
const Main = imports.ui.main;
const Tweener = imports.ui.tweener;
const Pango = imports.gi.Pango;


let WINDOWPREVIEW_SCALE = 0.5;
let POSITION_TOP = 1;
let POSITION_BOTTOM = 7;


/*
 * SET POSITION OF ICON AND WINDOW TITLE HERE: possible values are: POSITION_TOP
 * or POSITION_BOTTOM --------------------------------------------------------
 */
let ICON_TITLE_POSITION = POSITION_BOTTOM;
/* -------------------------------------------------------- */


/*
 * SET ICON SIZE AND SPACING BETWEEN ICON AND WINDOW TITLE HERE:
 * --------------------------------------------------------
 */
let ICON_SIZE = 64;  // default: 64
let ICON_TITLE_SPACING = 10;  // default: 10
/* -------------------------------------------------------- */


/*
 * SET VERTICAL OFFSET HERE: Positive vlaue means moving everything up, negative
 * down. Default means previews are located in the middle of the screen.
 * --------------------------------------------------------
 */
let OFFSET = 0;  // default: 0
/* -------------------------------------------------------- */




function Switcher(windows, actions) {
	this._init(windows, actions);
}

Switcher.prototype = {
		_init: function(windows, actions) {
			this._windows = windows;
			this._windowTitle = null;
			this._icon = null;
			this._modifierMask = null;
			this._currentIndex = 0;
			this._actions = actions;
			this._haveModal = false;
			this._tracker = Shell.WindowTracker.get_default();
			
			let monitor = Main.layoutManager.primaryMonitor;
			this.actor = new St.Group({ visible: true });

			// background
			this._background = new St.Group({
				style_class: 'coverflow-switcher',
				visible: true,
				x: 0,
				y: 0,
				opacity: 0,
				width: monitor.width,
				height: monitor.height,
			});
			this._background.add_actor(new St.Bin({
				style_class: 'coverflow-switcher-gradient',
				visible: true,
				x: 0,
				y: monitor.height / 2,
				width: monitor.width,
				height: monitor.height / 2,
			}));
			this.actor.add_actor(this._background);

			// create previews
			let currentWorkspace = global.screen.get_active_workspace();
			this._previewLayer = new St.Group({ visible: true });
			this._previews = [];
			for (let i in windows) {
				let metaWin = windows[i];
				let compositor = windows[i].get_compositor_private();
				if (compositor) {
					let texture = compositor.get_texture();
					let [width, height] = texture.get_size();

					let scale = 1.0;
					if (width > monitor.width * WINDOWPREVIEW_SCALE ||
							height > monitor.height * WINDOWPREVIEW_SCALE) {
						scale = Math.min(monitor.width * WINDOWPREVIEW_SCALE / width, monitor.height * WINDOWPREVIEW_SCALE / height);
					}

					let clone = new Clutter.Clone({
						opacity: (metaWin.get_workspace() == currentWorkspace || metaWin.is_on_all_workspaces()) ? 255 : 0,
								source: texture,
								reactive: false,
								//rotation_center_y: new Clutter.Vertex({ x: width * scale / 2, y: 0.0, z: 0.0 }),
								anchor_gravity: Clutter.Gravity.CENTER,
								x: compositor.x + compositor.width / 2,
								y: compositor.y + compositor.height / 2,
					});
										
					clone.target_width = Math.round(width * scale);
					clone.target_height = Math.round(height * scale);
//					clone.target_width_side = Math.round(width * scale * 0.9);
//					clone.target_height_side = Math.round(height * scale * 0.9);
					
//					let frame = new St.Bin({
//						visible: true, 
//						x: clone.x - 10,
//						y: clone.y - 10,
//						width: clone.width + 20,
//						height: clone.height + 20,
//					});
//					
//					frame.target_width = width * scale;
//					frame.target_height = height * scale;
//					frame.target_width_side = width * scale * 0.5;
//					frame.target_height_side = height * scale * 0.7;
//					
//					frame.add_actor(clone);
//					frame.set_anchor_point_from_gravity(Clutter.Gravity.CENTER);
					
					this._previews.push(clone);
					this._previewLayer.add_actor(clone);
				}
			}

			this.actor.add_actor(this._previewLayer);
			Main.uiGroup.add_actor(this.actor);
			
//			// shade effect
//			try {
//				let color = new Clutter.Color();
//				color.red = 0;
//				color.green = 0;
//				color.blue = 0;
//				color.alpha = 255;
//				this._shade_effect = new Clutter.ColorizeEffect();
//				this._shade_effect.set_tint(color);
//			} catch (e) {
//				global.log(e);
//			}
			
		},

		show: function(shellwm, binding, mask, window, backwards) {
			if (!Main.pushModal(this.actor)) {
				return false;
			}

			this._haveModal = true;
			this._modifierMask = AltTab.primaryModifier(mask);

			this.actor.connect('key-press-event', Lang.bind(this, this._keyPressEvent));
			this.actor.connect('key-release-event', Lang.bind(this, this._keyReleaseEvent));
			this.actor.show();

			// hide all window actors
			let windows = global.get_window_actors();
			for (let i in windows) {
				windows[i].hide();
			}

			this._next();

			// There's a race condition; if the user released Alt before
			// we gotthe grab, then we won't be notified. (See
			// https://bugzilla.gnome.org/show_bug.cgi?id=596695 for
			// details) So we check now. (Have to do this after updating
			// selection.)
			let [x, y, mods] = global.get_pointer();
			if (!(mods & this._modifierMask)) {
				this._activateSelected();
				return false;
			}

			Tweener.addTween(this._background, {
				opacity: 255,
				time: 0.25,
				transition: 'easeOutQuad'
			});

			return true;
		},

		_next: function() {
			this._currentIndex = (this._currentIndex + 1) % this._windows.length;
			this._updateCoverflow();
		},

		_previous: function() {
			this._currentIndex = (this._currentIndex + this._windows.length - 1) % this._windows.length;
			this._updateCoverflow();
		},

		_updateCoverflow: function() {
//			global.log("nach update " + global.get_window_actors().length);
			let monitor = Main.layoutManager.primaryMonitor;

			// window title label
			if (this._windowTitle) {
				Tweener.addTween(this._windowTitle, {
					opacity: 0,
					time: 0.25,
					transition: 'easeOutQuad',
					onComplete: Lang.bind(this._background, this._background.remove_actor, this._windowTitle),
				});
			}
			this._windowTitle = new St.Label({
				style_class: 'modal-dialog',
				text: this._windows[this._currentIndex].get_title(),
				opacity: 0,
			});
			
			this._windowTitle.set_anchor_point_from_gravity(Clutter.Gravity.CENTER);
			
			// ellipsize if title is too long
			this._windowTitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;
			if (this._windowTitle.clutter_text.width > (monitor.width - 200)) {
				this._windowTitle.clutter_text.width = monitor.width - 200;
			}
			
			this._windowTitle.add_style_class_name('run-dialog');
			this._windowTitle.add_style_class_name('coverflow-window-title-label');
			this._background.add_actor(this._windowTitle);
			this._windowTitle.x = Math.round((monitor.width + ICON_SIZE + ICON_TITLE_SPACING) / 2);
			this._windowTitle.y = Math.round(monitor.height * ICON_TITLE_POSITION / 8 - OFFSET);
			Tweener.addTween(this._windowTitle, {
				opacity: 255,
				time: 0.25,
				transition: 'easeOutQuad',
			});

			// window icon
			if (this._applicationIconBox) {
				Tweener.addTween(this._applicationIconBox, {
					opacity: 0,
					time: 0.25,
					transition: 'easeOutQuad',
					onComplete: Lang.bind(this._background, this._background.remove_actor, this._applicationIconBox),
				});
			}
			
			let app = this._tracker.get_window_app(this._windows[this._currentIndex]); 
			this._icon = null;
			if (app) {
				this._icon = app.create_icon_texture(ICON_SIZE);
			}
			if (!this._icon) {
				this._icon = new St.Icon({ icon_name: 'applications-other',
					icon_type: St.IconType.FULLCOLOR,
					icon_size: ICON_SIZE });
			}
			this._icon.width = ICON_SIZE;
			this._icon.height = ICON_SIZE;

			this._applicationIconBox = new St.Bin({ style_class: 'window-iconbox' });
			this._applicationIconBox.set_opacity(255);
			this._applicationIconBox.add_actor(this._icon);
			this._applicationIconBox.set_anchor_point_from_gravity(Clutter.Gravity.CENTER);

			this._background.add_actor(this._applicationIconBox);
			this._applicationIconBox.x = Math.round(this._windowTitle.x - (this._windowTitle.width + this._applicationIconBox.width) / 2 - ICON_TITLE_SPACING);
			this._applicationIconBox.y = this._windowTitle.y;
			Tweener.addTween(this._applicationIconBox, {
				opacity: 255,
				time: 0.25,
				transition: 'easeOutQuad',
			});


			// preview windows
			for (let i in this._previews) {
				let preview = this._previews[i];

				if (i == this._currentIndex) {
					preview.move_anchor_point_from_gravity(Clutter.Gravity.CENTER);
					preview.raise_top();
					Tweener.addTween(preview, {
						opacity: 255,
						x: (monitor.width) / 2,
						y: (monitor.height) / 2 - OFFSET,
						width: preview.target_width,
						height: preview.target_height,
						rotation_angle_y: 0.0,
						time: 0.25,
						transition: 'easeOutQuad',
					});
				} else if (i < this._currentIndex) {
					preview.move_anchor_point_from_gravity(Clutter.Gravity.WEST);
					preview.raise_top();
					Tweener.addTween(preview, {
//						opacity: 255,
//						x: monitor.width * 0.2 - preview.target_width_side / 2 + 25 * (i - this._currentIndex),
//						y: (monitor.height - preview.target_height_side) / 2 - OFFSET,
//						width: preview.target_width_side,
//						height: preview.target_height_side,
//						rotation_angle_y: 60.0,
//						time: 0.25,
//						transition: 'easeOutQuad',
						opacity: 255,
						x: monitor.width * 0.1 + 50 * (i - this._currentIndex),
						y: monitor.height / 2 - OFFSET,
						width: preview.target_width * (10 - Math.abs(i - this._currentIndex)) / 10,
						height: preview.target_height * (10 - Math.abs(i - this._currentIndex)) / 10,
						rotation_angle_y: 60.0,
//						effect: this._shade_effect,
						time: 0.25,
						transition: 'easeOutQuad',
					});
				} else if (i > this._currentIndex) {
					preview.move_anchor_point_from_gravity(Clutter.Gravity.EAST);
					preview.lower_bottom();
					Tweener.addTween(preview, {
//						opacity: 255,
//						x: monitor.width * 0.8 - preview.target_width_side / 2 + 25 * (i - this._currentIndex),
//						y: (monitor.height - preview.target_height_side) / 2 - OFFSET,
//						width: preview.target_width_side,
//						height: preview.target_height_side,
//						rotation_angle_y: -60.0,
//						time: 0.25,
//						transition: 'easeOutQuad',
						opacity: 255,
						x: monitor.width * 0.9 + 50 * (i - this._currentIndex),
						y: monitor.height / 2 - OFFSET,
						width: preview.target_width * (10 - Math.abs(i - this._currentIndex)) / 10,
						height: preview.target_height * (10 - Math.abs(i - this._currentIndex)) / 10,
						rotation_angle_y: -60.0,
//						effect: this._shade_effect,
						time: 0.25,
						transition: 'easeOutQuad',
					});
				}
			}
		},

		_keyPressEvent: function(actor, event) {
			let keysym = event.get_key_symbol();
			let event_state = Shell.get_event_state(event);

			let backwards = event_state & Clutter.ModifierType.SHIFT_MASK;
			let action = global.display.get_keybinding_action(event.get_key_code(), event_state);

			if (keysym == Clutter.Escape) {
				this.destroy();
			} else if (keysym == Clutter.q || keysym == Clutter.Q) {
				this._actions['remove_selected'](this._windows[this._currentIndex]);
				if (this._windows.length == 1) {
					this.destroy();
				} else {
					this._windows.splice(this._currentIndex, 1);
					this._previews[this._currentIndex].destroy();
					this._previews.splice(this._currentIndex, 1);
					this._currentIndex = this._currentIndex % this._windows.length;
					this._updateCoverflow();
//					// check if window was removed successfully
//					if (global.get_window_actors().length > this._windows.length + this._windows_skipped + 1) {
//						this.destroy();
//					} else {
////						global.log("nach q " + global.get_window_actors().length);
//						this._updateCoverflow();
//					}
				}
			} else if (action == Meta.KeyBindingAction.SWITCH_GROUP ||
					action == Meta.KeyBindingAction.SWITCH_WINDOWS ||
					action == Meta.KeyBindingAction.SWITCH_PANELS) {
				backwards ? this._previous() : this._next();
			} else if (action == Meta.KeyBindingAction.SWITCH_GROUP_BACKWARD ||
					action == Meta.KeyBindingAction.SWITCH_WINDOWS_BACKWARD) {
				this._previous();
			}

			return true;
		},

		_keyReleaseEvent: function(actor, event) {
			let [x, y, mods] = global.get_pointer();
			let state = mods & this._modifierMask;

			if (state == 0) {
				this._activateSelected();
			}

			return true;
		},

		_activateSelected: function() {
			this._actions['activate_selected'](this._windows[this._currentIndex]);
			this.destroy();
		},

		_onHideBackgroundCompleted: function() {
			Main.uiGroup.remove_actor(this.actor);

			// show all window actors
			let currentWorkspace = global.screen.get_active_workspace();
			let windows = global.get_window_actors();
			for (let i in windows) {
				let metaWin = windows[i].get_meta_window();
				if (metaWin.get_workspace() == currentWorkspace || metaWin.is_on_all_workspaces()) {
					windows[i].show();
				}
			}
		},

		_onDestroy: function() {
			let monitor = Main.layoutManager.primaryMonitor;

			// preview windows
			let currentWorkspace = global.screen.get_active_workspace();
			for (let i in this._previews) {
				let preview = this._previews[i];
				let metaWin = this._windows[i];
				let compositor = this._windows[i].get_compositor_private();
				
				preview.move_anchor_point_from_gravity(Clutter.Gravity.CENTER);
				
				Tweener.addTween(preview, {
							opacity: (!metaWin.minimized && metaWin.get_workspace() == currentWorkspace 
									  || metaWin.is_on_all_workspaces()) ? 255 : 0,
							x: compositor.x + compositor.width / 2,
							y: compositor.y + compositor.height / 2,
							width: (metaWin.minimized) ? 0 : compositor.width,
							height: (metaWin.minimized) ? 0 : compositor.height,
							rotation_angle_y: 0.0,
							time: 0.25,
							transition: 'easeOutQuad',
				});
			}

			// background
			Tweener.removeTweens(this._background);
			Tweener.addTween(this._background, {
				opacity: 0,
				time: 0.25,
				transition: 'easeOutQuad',
				onComplete: Lang.bind(this, this._onHideBackgroundCompleted),
			});

			if (this._haveModal) {
				Main.popModal(this.actor);
				this._haveModal = false;
			}

			this._windows = null;
			this._windowTitle = null;
			this._icon = null;
			this._applicationIconBox = null;
			this._previews = null;
			this._previewLayer = null;
		},

		destroy: function() {
			this._onDestroy();
		},
}
