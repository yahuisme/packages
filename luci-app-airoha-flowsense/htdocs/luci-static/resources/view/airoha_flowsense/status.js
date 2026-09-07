'use strict';
'require view';
'require rpc';
'require poll';
'require ui';

var overview = rpc.declare({ object: 'luci.airoha_flowsense', method: 'getOverview', raise: true });
var flows = rpc.declare({ object: 'luci.airoha_flowsense', method: 'getPpeEntries', raise: true });
var saveMonitor = rpc.declare({ object: 'luci.airoha_flowsense', method: 'setMonitor', params: ['target', 'enabled'], raise: true });
function value(v, suffix) { return v == null ? '—' : v + (suffix || ''); }
function enabled(v) { return v === true ? _('Enabled') : v === false ? _('Disabled') : _('Unknown'); }
function metric(label, node) {
    return E('div', { 'class': 'cbi-value' }, [ E('span', { 'class': 'cbi-value-title' }, label), E('div', { 'class': 'cbi-value-field' }, node) ]);
}
function change(current, previous, key, dt) {
    if (!previous || !(dt > 0) || current[key] == null || previous[key] == null || current[key] < previous[key]) return null;
    return current[key] - previous[key];
}
return view.extend({
    load: function() { return Promise.resolve(); },
    render: function() {
        var active = 0, paused = false, previous = null, dirty = false;
        var message = E('div', { 'class': 'cbi-section-descr' }, _('Waiting for data'));
        var hw = E('span'), sw = E('span'), counts = E('span'), ip = E('span');
        var ping = E('span'), deviation = E('span'), loss = E('span');
        var interfaces = E('div');
        var target = E('input', { id: 'fs-target', name: 'fs-target', 'class': 'cbi-input-text', style: 'width:192px', maxlength: 253 });
        var monitor = E('input', { id: 'fs-monitor', name: 'fs-monitor', type: 'checkbox' });
        target.addEventListener('input', function() { dirty = true; });
        monitor.addEventListener('change', function() { dirty = true; });
        var button = E('button', { 'class': 'cbi-button cbi-button-apply', click: function() {
            if (!target.value.trim()) { target.focus(); return; }
            button.disabled = true;
            return saveMonitor(target.value.trim(), monitor.checked ? 1 : 0).then(function(result) {
                if (!result || result.success !== true) throw new Error(_('Unable to apply monitor settings. Check the target and service.'));
                dirty = false;
                return update();
            }).catch(function(err) { ui.addNotification(null, E('p', {}, err.message), 'error'); })
                .finally(function() { button.disabled = false; });
        } }, _('Save & Apply'));
        var first = E('div', {}, [
            E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('Offload configuration')), metric(_('Hardware flow offload'), hw), metric(_('Software flow offload'), sw),
                E('div', { 'class': 'cbi-section-descr' }, _('Configured switches do not prove that individual connections are offloaded.'))]),
            E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('PPE summary')), metric(_('Bound / Unbound flows'), counts), metric(_('IPv4 / IPv6 / Other'), ip)]),
            E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('Ethernet links')), E('div', { 'class': 'cbi-section-descr' }, _('Rates use interface counters; hardware-bypassed traffic may not be fully counted. Errors and drops are interval increments.')), interfaces]),
            E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('Link quality')), metric(_('Latest RTT'), ping), metric(_('RTT mean absolute deviation'), deviation), metric(_('Window packet loss'), loss),
                E('div', { 'class': 'cbi-value' }, [E('label', { 'class': 'cbi-value-title', 'for': 'fs-target' }, _('IPv4 address or hostname')), E('div', { 'class': 'cbi-value-field' }, target)]),
                E('div', { 'class': 'cbi-value' }, [E('label', { 'class': 'cbi-value-title', 'for': 'fs-monitor' }, _('Enable periodic probes')), E('div', { 'class': 'cbi-value-field' }, monitor)]), button])
        ]);
        var detail = E('div'), detailMessage = E('div', { 'class': 'cbi-section-descr' });
        var pause = E('button', { 'class': 'cbi-button', click: function() { paused = !paused; pause.textContent = paused ? _('Resume') : _('Pause'); if (!paused) update(); } }, _('Pause'));
        var second = E('div', { style: 'display:none' }, [pause, detailMessage, detail]);
        var panes = [first, second], nav = E('ul', { 'class': 'cbi-tabmenu' });
        [_('Overview & Quality'), _('PPE Flow Offload')].forEach(function(label, index) {
            nav.appendChild(E('li', { 'class': index ? 'cbi-tab-disabled' : 'cbi-tab' }, E('a', { href: '#', click: function(event) {
                event.preventDefault(); active = index;
                panes.forEach(function(p, i) { p.style.display = i === active ? '' : 'none'; nav.children[i].className = i === active ? 'cbi-tab' : 'cbi-tab-disabled'; });
                update();
            } }, label)));
        });
        var root = E('div', { 'class': 'cbi-map' }, [E('h2', {}, _('Airoha FlowSense')), message, nav, first, second]);
        var pending = null;
        function update() {
            if (pending) return pending;
            pending = overview().then(function(data) {
                if (!root.isConnected) return;
                hw.textContent = enabled(data.configured_hw); sw.textContent = enabled(data.configured_sw);
                var ppe = data.ppe || {};
                counts.textContent = ppe.available ? ppe.bnd + ' / ' + ppe.unb : _('Unavailable');
                ip.textContent = ppe.available ? ppe.ipv4 + ' / ' + ppe.ipv6 + ' / ' + ppe.other : '—';
                if (!dirty) { target.value = data.monitor.target; monitor.checked = data.monitor.enabled === true; }
                var jitter = data.jitter;
                ping.textContent = jitter ? value(jitter.last_ping, ' ms') : _('Stopped or stale');
                deviation.textContent = jitter ? value(jitter.deviation, ' ms') : '—';
                loss.textContent = jitter ? value(jitter.loss, '%') + ' (' + jitter.received + '/' + jitter.samples + ')' : '—';
                interfaces.replaceChildren();
                (data.interfaces || []).forEach(function(port) {
                    var before = previous && previous.ports[port.device], dt = previous ? data.uptime - previous.time : 0;
                    if (before && before.ifindex !== port.ifindex) before = null;
                    var rx = change(port.stats, before && before.stats, 'rx_bytes', dt), tx = change(port.stats, before && before.stats, 'tx_bytes', dt);
                    var card = E('div', { 'class': 'cbi-section-node' }, [E('h4', {}, port.device),
                        metric(_('Link / Speed'), (port.carrier == null ? _('Unknown') : port.carrier ? _('Up') : _('Down')) + ' / ' + value(port.speed, ' Mbit/s')),
                        metric(_('RX / TX rate'), (rx == null ? '—' : (rx * 8 / dt / 1000000).toFixed(2)) + ' / ' + (tx == null ? '—' : (tx * 8 / dt / 1000000).toFixed(2)) + ' Mbit/s')]);
                    ['rx_errors','tx_errors','rx_dropped','tx_dropped'].forEach(function(key, i) { card.appendChild(metric([_('RX errors'),_('TX errors'),_('RX drops'),_('TX drops')][i], value(change(port.stats, before && before.stats, key, dt)))); });
                    interfaces.appendChild(card);
                });
                previous = { time: data.uptime, ports: {} }; (data.interfaces || []).forEach(function(p) { previous.ports[p.device] = p; });
                message.textContent = _('Last update') + ': ' + new Date(data.timestamp * 1000).toLocaleTimeString();
                if (active !== 1 || paused) return;
                return flows().then(function(p) {
                    if (!root.isConnected || active !== 1 || paused) return;
                    detail.replaceChildren();
                    if (!p.available) { detailMessage.textContent = _('PPE data unavailable'); return; }
                    detailMessage.textContent = _('Shown / Total') + ': ' + p.entries.length + ' / ' + p.total;
                    p.entries.forEach(function(entry) {
                        detail.appendChild(E('details', { 'class': 'cbi-section-node' }, [E('summary', { style: 'cursor:pointer;padding:8px 0' }, entry.index + ' · ' + entry.state + ' · ' + entry.type),
                            metric(_('Original Flow'), entry.orig || '—'), metric(_('New Flow'), entry.new_flow || '—')]));
                    });
                });
            }).catch(function() {
                if (!root.isConnected) return;
                previous = null; message.textContent = _('Data unavailable; previous readings cleared.');
                [hw,sw,counts,ip,ping,deviation,loss].forEach(function(el) { el.textContent = '—'; }); interfaces.replaceChildren(); detail.replaceChildren(); detailMessage.textContent = _('PPE data unavailable');
            }).finally(function() { pending = null; });
            return pending;
        }
        requestAnimationFrame(function() { if (root.isConnected) { update(); poll.add(update, 5); } });
        return root;
    },
    handleSaveApply: null, handleSave: null, handleReset: null
});
