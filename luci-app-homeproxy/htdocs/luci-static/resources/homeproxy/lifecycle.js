'use strict';
'require baseclass';
'require poll';

// Keep transport locks outside widgets recreated by form.Map.reset().
const pending = Object.create(null);

function watch(node, attach, detach) {
	let mounted = false, active = true;
	const observer = new MutationObserver(() => {
		if (node.isConnected && !mounted) {
			mounted = true;
			attach();
		} else if (mounted && !node.isConnected) {
			active = false;
			observer.disconnect();
			detach();
		}
	});
	observer.observe(document.documentElement, { childList: true, subtree: true });
	return () => active && node.isConnected;
}

return baseclass.extend({
	watch: watch,

	poll(node, key, read, update, interval, immediate) {
		const alive = watch(node, () => {
			poll.add(refresh, interval);
			if (immediate)
				refresh();
		}, () => poll.remove(refresh));
		const refresh = () => {
			if (!alive() || pending[key])
				return Promise.resolve();
			pending[key] = true;
			return Promise.resolve().then(() => alive() ? read() : undefined).then((value) => {
				if (alive())
					update(value);
			}).finally(() => { delete pending[key]; });
		};
	}
});
