const assert = require('assert/strict');
const { pageBoot, tick } = require('./helpers/test_page_lifecycle.cjs');

(async () => {
	const h = await pageBoot('node');
	try {
		const { w, mods } = h;
		const map = new mods.form.Map('homeproxy');
		const section = map.section(mods.form.NamedSection, 'subscription', 'homeproxy');
		const option = section.option(mods.form.Button, '_upload_test', 'Upload');
		option.onclick = w.L.bind(mods.homeproxy.uploadCertificate, mods.homeproxy, 'certificate', 'client_ca');

		let uploadTarget = null;
		let writeParams = null;
		const requestPost = mods.request.post;
		mods.request.post = (url, req) => {
			if (req.params[2] === 'certificate_write')
				writeParams = req.params[3].filename;
			return requestPost(url, req);
		};
		mods.ui.uploadFile = async (_path, target) => {
			uploadTarget = target;
			return { size: 17 };
		};

		const widget = option.renderWidget('subscription', 0, null);
		const host = w.document.createElement('div');
		host.append(widget);
		w.document.body.append(host);
		const output = host.querySelector('output');
		const button = output && output.querySelector('button');
		assert(button, 'native form.Button.renderWidget must render a visible button');
		await option.onclick({ target: button, currentTarget: button }, 'subscription');

		assert.equal(uploadTarget, button, 'native onclick(ev, section_id) event must reach uploadFile');
		assert.equal(writeParams, 'client_ca', 'bound filename must be sent unchanged');
		console.log('PASS native form.Button contract preserves upload event and certificate filename');
	} finally {
		h.w.close();
	}
})().catch(err => {
	console.error(err);
	process.exitCode = 1;
});
