'use strict';
'require baseclass';
'require form';
'require ui';

function split(value) {
	const index = value.indexOf('#');
	let name = index < 0 ? '' : value.slice(index + 1);
	try { name = decodeURIComponent(name); } catch (e) { }
	return { url: index < 0 ? value : value.slice(0, index), name };
}

function join(url, name) {
	try { return url + (name ? '#' + encodeURIComponent(name) : ''); }
	catch (e) { return url + '#' + name; }
}

function hostname(url) {
	try { return new URL(url).hostname; } catch (e) { return ''; }
}

const LinkList = ui.DynamicList.extend({
	render() {
		const list = this.super('render', arguments);
		list.classList.add('hp-subscription-links');
		const add = list.querySelector('.add-item');
		const url = add.querySelector('input');
		url.classList.add('hp-subscription-url');
		url.placeholder = 'https://';
		const name = E('input', {
			'type': 'text', 'class': 'cbi-input-text hp-subscription-name',
			'id': this.options.id + '.name', 'disabled': this.options.disabled || null,
			'placeholder': _('Hostname when empty')
		});
		const urlLabel = E('label', { 'for': url.id }, [ E('span', { 'class': 'hp-subscription-label' }, _('Subscription URL')), url ]);
		const nameLabel = E('label', { 'for': name.id }, [ E('span', { 'class': 'hp-subscription-label' }, _('Group name (optional)')), name ]);
		add.prepend(nameLabel, urlLabel);
		const button = add.querySelector('.cbi-button-add');
		button.setAttribute('role', 'button');
		button.setAttribute('aria-label', _('Add subscription'));
		button.tabIndex = this.options.disabled ? -1 : 0;
		for (const input of [name, url]) {
			input.addEventListener('input', () => this.dispatchCbiDynlistChange(list, url.value));
			input.addEventListener('touchstart', ev => ev.stopPropagation());
		}
		return E('div', { 'class': 'hp-subscription-editor' }, [
			E('style', {}, [
				'.hp-subscription-editor{container-type:inline-size;min-width:0;max-width:100%}' +
				'.hp-subscription-editor .hp-subscription-links,.hp-subscription-editor .hp-subscription-columns{width:min(100%,56rem);max-width:100%;min-width:0}' +
				'.hp-subscription-editor .hp-subscription-links{display:block}' +
				'.hp-subscription-columns,.hp-subscription-links>.item,.hp-subscription-links>.add-item{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr) 34px;gap:8px;align-items:end;margin:0 0 8px;padding:0;border:0;background:transparent;white-space:normal}' +
				'.hp-subscription-links>div>.cbi-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:34px;min-width:34px;height:34px;min-height:34px;padding:0;margin:0}' +
				'.hp-subscription-links>.item::after{display:none}' +
				'.hp-subscription-links>div>label{display:grid;gap:8px;margin:0;min-width:0;font-size:inherit}' +
				'.hp-subscription-label{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}' +
				'.hp-subscription-links .hp-subscription-name,.hp-subscription-links .hp-subscription-url{box-sizing:border-box;min-width:0;width:100%;max-width:100%}' +
				'@container(max-width:480px){.hp-subscription-links>.item,.hp-subscription-links>.add-item{grid-template-columns:minmax(0,1fr) auto}' +
				'.hp-subscription-columns{display:none}.hp-subscription-label{position:static;width:auto;height:auto;margin:0;overflow:visible;clip:auto;white-space:normal}' +
				'.hp-subscription-links>div>label{grid-column:1}.hp-subscription-links>div>.cbi-button{grid-column:2;grid-row:2}}' +
				'@media(max-width:600px){.hp-subscription-links>.item,.hp-subscription-links>.add-item{grid-template-columns:minmax(0,1fr) auto}' +
				'.hp-subscription-columns{display:none}.hp-subscription-label{position:static;width:auto;height:auto;margin:0;overflow:visible;clip:auto;white-space:normal}' +
				'.hp-subscription-links>div>label{grid-column:1}.hp-subscription-links>div>.cbi-button{grid-column:2;grid-row:2}}'
			]),
			E('div', { 'class': 'hp-subscription-columns', 'aria-hidden': 'true' }, [
				E('span', {}, _('Group name (optional)')), E('span', {}, _('Subscription URL'))
			]), list
		]);
	},

	initDragAndDrop(list) {
		if (this.options.disabled)
			return;
		// Native drops recognize only the row itself, not its editable children.
		let dragging = false;
		list.addEventListener('dragstart', ev => { dragging = ev.target.classList.contains('item'); });
		list.addEventListener('drop', ev => {
			const item = ev.target.closest('.item');
			if (item && ev.target !== item && dragging) {
				ev.preventDefault();
				ev.stopImmediatePropagation();
				item.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
			}
		});
		list.addEventListener('dragend', () => { dragging = false; });
		this.super('initDragAndDrop', arguments);
		list.addEventListener('touchcancel', () => {
			const item = list.querySelector('.item.dragging');
			const placeholder = list.querySelector('.placeholder');
			if (item && placeholder) {
				list.insertBefore(placeholder, item.nextSibling);
				list.dispatchEvent(new Event('touchend', { bubbles: true }));
			}
		});
	},

	addItem(list, value, text, flash) {
		this.super('addItem', arguments);
		for (const item of list.querySelectorAll('.item')) {
			if (item.querySelector('.hp-subscription-name'))
				continue;
			item.draggable = !this.options.disabled;
			const hidden = item.querySelector('input[type="hidden"]');
			const initial = split(hidden.value);
			const name = E('input', { 'type': 'text', 'class': 'cbi-input-text hp-subscription-name',
				'value': initial.name, 'placeholder': hostname(initial.url) || _('Hostname when empty'),
				'disabled': this.options.disabled || null });
			const url = E('input', { 'type': 'text', 'class': 'cbi-input-text hp-subscription-url',
				'value': initial.url, 'disabled': this.options.disabled || null });
			item.querySelector('span').remove();
			item.prepend(E('label', {}, [ E('span', { 'class': 'hp-subscription-label' }, _('Group name (optional)')), name ]),
				E('label', {}, [ E('span', { 'class': 'hp-subscription-label' }, _('Subscription URL')), url ]));
			item.appendChild(E('button', { 'type': 'button', 'class': 'cbi-button cbi-button-remove',
				'aria-label': _('Remove subscription'), 'disabled': this.options.disabled || null,
				'click': () => { if (!this.options.disabled) this.removeItem(list, item); }
			}, [ '−' ]));
			for (const input of [name, url]) {
				input.addEventListener('input', () => {
					if (this.options.disabled)
						return;
					hidden.value = name.value ? join(split(url.value).url, name.value) : url.value;
					name.placeholder = hostname(url.value) || _('Hostname when empty');
					this.dispatchCbiDynlistChange(list, hidden.value);
				});
				input.addEventListener('touchstart', ev => ev.stopPropagation());
			}
		}
	},

	handleClick(ev) {
		if (this.options.disabled || !ev.target.closest('.add-item .cbi-button-add'))
			return;
		const url = this.node.querySelector('.add-item .hp-subscription-url');
		const name = this.node.querySelector('.add-item .hp-subscription-name');
		const value = name.value ? join(split(url.value).url, name.value) : url.value;
		const exists = Array.from(this.node.querySelectorAll('.item > input[type="hidden"]')).some(input => input.value === value);
		if (url.value && (exists || this.options.validate() === true)) {
			if (!exists) this.addItem(this.node, value, null, true);
			url.value = name.value = '';
			this.dispatchCbiDynlistChange(this.node, '');
		}
	},

	handleKeydown(ev) {
		if (this.options.disabled)
			return;
		if (ev.target.matches('input,button,[role="button"]')) {
			if ((ev.keyCode === 13 || (ev.keyCode === 32 && ev.target.matches('[role="button"]'))) && ev.target.closest('.add-item')) {
				this.handleClick({ target: this.node.querySelector('.add-item .cbi-button-add') });
				ev.preventDefault();
			}
			return;
		}
		return this.super('handleKeydown', arguments);
	},

	isValid() {
		if (typeof(this.vfunc) === 'function') this.vfunc();
		return this.super('isValid', arguments);
	},

	getValue() {
		const values = Array.from(this.node.querySelectorAll('.item > input[type="hidden"]'), input => input.value);
		const url = this.node.querySelector('.add-item .hp-subscription-url');
		const name = this.node.querySelector('.add-item .hp-subscription-name');
		if (url?.value || name?.value)
			values.push(name.value ? join(split(url.value).url, name.value) : url.value);
		return values;
	}
});

return baseclass.extend({ URLList: form.DynamicList.extend({
	renderWidget(section_id, option_index, cfgvalue) {
		const widget = new LinkList(L.toArray(cfgvalue != null ? cfgvalue : this.default), null, {
			id: this.cbid(section_id), optional: this.optional || this.rmempty,
			validate: () => {
				const seen = new Set();
				for (const input of widget.node.querySelectorAll('.hp-subscription-name')) {
					try { encodeURIComponent(input.value); }
					catch (e) { return _('Enter a valid single-line group name.'); }
					if (/[\r\n]/.test(input.value))
						return _('Enter a valid single-line group name.');
				}
				for (const value of widget.getValue()) {
					const { url, name } = split(value);
					if (!url)
						return _('Expecting: %s').format(_('valid URL'));
					if (/[\r\n]/.test(name))
						return _('Enter a valid single-line group name.');
					if (seen.has(url))
						return _('This subscription URL is already listed.');
					seen.add(url);
					const result = this.validate(section_id, value);
					if (result !== true)
						return result;
				}
				return true;
			},
			disabled: this.readonly != null ? this.readonly : this.map.readonly
		});
		return widget.render();
	}
}) });
