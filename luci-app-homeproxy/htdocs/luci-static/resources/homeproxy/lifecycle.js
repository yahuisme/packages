'use strict';
'require baseclass';
'require poll';

// Keep transport locks outside widgets recreated by form.Map.reset().
const pending = Object.create(null);

function watch(node, attach, detach) {
	let mounted = false, active = true;
	/* Watch the view container, never the whole document: `watch()` receives
	 * nodes nested inside a rendered map, so the container needs subtree, but
	 * the sidebar, header and notifications must not trigger this callback. */
	const host = document.getElementById('view') || document.body;
	const observer = new MutationObserver(() => {
		if (node.isConnected) {
			if (!mounted) {
				mounted = true;
				attach();
			}
		} else if (mounted) {
			active = false;
			observer.disconnect();
			detach();
		}
	});
	observer.observe(host, { childList: true, subtree: !!host.id });
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
