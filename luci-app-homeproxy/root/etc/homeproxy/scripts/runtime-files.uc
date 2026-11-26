/* SPDX-License-Identifier: GPL-2.0-only */

import { chmod, chown, error, lstat, open, readfile, rename, stat, unlink } from 'fs';
import { sha256 } from 'digest';

export const logNames = ['homeproxy', 'sing-box-c', 'sing-box-s'];

// The pinned fs binding reports strerror(), not errno. Do not treat a failed
// inspection as an unsafe entry to remove (or as a safe entry to open).
function inspect(path) {
	const info = lstat(path);
	if (!info && error() !== 'No such file or directory')
		die('Failed to inspect runtime file.');
	return info;
}

function regular(info) {
	return info?.type === 'file' && info.nlink === 1;
}

// The shell first takes ownership of the parent and removes write access.
// Only then may we unlink confirmed legacy entries or open a log for append.
export function prepareFiles(dir, names, create, mode) {
	for (let name in names) {
		const path = `${dir}/${name}`;
		const info = inspect(path);
		if (info && !regular(info) && unlink(path) !== true)
			die('Failed to remove an unsafe runtime entry.');
	}
	const path = `${dir}/${create}`;
	const fd = open(path, 'a', mode);
	if (!fd || fd.close() !== true || chown(path, 0, 0) !== true || chmod(path, mode) !== true)
		die('Failed to prepare runtime file.');
};

function safeRuntime(dir) {
	const runtime = inspect(dir);
	if (runtime && (runtime.type !== 'directory' || runtime.uid !== 0 || (runtime.mode & 0022)))
		die('unsafe runtime directory');
}

function identity(info) {
	return `${info.dev.major}:${info.dev.minor}:${info.inode}`;
}

function withLog(dir, name, writing, action) {
	safeRuntime(dir);
	const path = `${dir}/${name}.log`;
	const before = inspect(path);
	if (!before)
		return null;
	if (!regular(before))
		die('unsafe log file');
	const fd = open(path, writing ? 'r+' : 'r');
	if (!fd)
		die('failed to open log file');
	let result;
	try {
		// Never block rpcd on a lock on a service-accessible inode. Keep
		// read/clear serialized without replacing existing append descriptors.
		if (fd.lock(writing ? 'xn' : 'sn') !== true)
			die('log file is busy');
		const actual = stat(`/proc/self/fd/${fd.fileno()}`);
		const current = inspect(path);
		if (!regular(actual) || !regular(current) || identity(actual) !== identity(current))
			die('log file changed during access');
		result = action(fd, actual, `${path}.generation`);
	} catch (e) {
		fd.close();
		die(e.message);
	}
	fd.close();
	return result;
}

function generation(path) {
	const info = inspect(path);
	if (!info)
		return 0;
	if (!regular(info) || info.uid !== 0 || (info.mode & 0022) || info.size > 16)
		die('unsafe log generation');
	const value = readfile(path);
	if (!match(value, /^[0-9]{1,15}$/))
		die('invalid log generation');
	return int(value);
}

function publishGeneration(marker, value) {
	// The exclusive log lock serializes publishers. The runtime directory
	// is root-owned; a stale stage may be unlinked without following it.
	const stage = `${marker}.new`;
	if (inspect(stage) && unlink(stage) !== true)
		die('failed to publish log generation');
	const fd = open(stage, 'wx', 0600);
	if (!fd)
		die('failed to publish log generation');
	const written = fd.write(value);
	const closed = fd.close();
	if (written !== length(value) || closed !== true || readfile(stage) !== value || rename(stage, marker) !== true) {
		unlink(stage);
		die('failed to publish log generation');
	}
}

export function cleanLog(dir, name, limit) {
	withLog(dir, name, true, (fd, info, marker) => {
		if (info.size < limit)
			return;
		// Publish a new generation even if the replacement bytes repeat the
		// old prefix. Write it before truncating; failure never clears bytes.
		publishGeneration(marker, '' + (generation(marker) + 1));
		if (fd.truncate() !== true)
			die('failed to clean log file');
	});
};

function readAt(fd, start, count) {
	if (count === 0)
		return '';
	if (fd.seek(start) !== true)
		die('failed to seek log file');
	const data = fd.read(count);
	if (data === null || length(data) !== count)
		die('log file changed during read');
	return data;
}

export function readLog(dir, name, offset, cursor) {
	return withLog(dir, name, false, (fd, info, marker) => {
		const window = 65536;
		const version = `${identity(info)}:${generation(marker)}`;
		const token = (end) => {
			const last = end > 64 ? end - 64 : 0;
			// A bounded prefix and boundary sample also catch ordinary in-place
			// resets by an external writer that does not use our cleaner.
			return sha256(`${version}:${end}:` + readAt(fd, 0, end < 64 ? end : 64) +
				(last > 0 ? readAt(fd, last, end - last) : ''));
		};
		const size = info.size;
		const reset = type(offset) !== 'int' || offset < 0 || offset > size ||
			type(cursor) !== 'string' || length(cursor) !== 64 || cursor !== token(offset);
		const start = reset ? (size > window ? size - window : 0) : offset;
		const count = size - start > window ? window : size - start;
		const next = start + count;
		let data = readAt(fd, start, count);
		if (reset && start > 0 && readAt(fd, start - 1, 1) !== '\n') {
			const nl = index(data, '\n');
			if (nl >= 0)
				data = substr(data, nl + 1);
			else {
				// Very long lines are still useful, but do not begin with a
				// UTF-8 continuation byte from the discarded prefix.
				let skip = 0;
				while (skip < 3 && (ord(data, skip) & 0xc0) === 0x80)
					skip++;
				data = substr(data, skip);
			}
		}
		return { status: 'ok', size, offset: next, reset, cursor: !reset && next === offset ? cursor : token(next),
			data_b64: b64enc(data) };
	}) || { status: 'missing' };
};
