// jx3box page size seems to be topping at 20.
const ENTRIES_PER_PAGE = 20;

const PZ_CACHE = {}

// From attr code name to display name.
const ATTR_MAP = {
	'attack': '面板攻击',
	'hitPercent': '命中',
	'strainPercent': '无双',
	'critialPercent': '会心',
	'criticalDamagePercent': '会效',
	'overcome': '破防',
	'toughnessPercent': '御劲',
	'decriticalDamagePercent': '化劲',
};

function getPromise(url) {
	return new Promise(function (resolve, reject) {
		let xhr = new XMLHttpRequest();
		xhr.open('GET', url);
		xhr.onload = () => resolve(xhr.response);
		xhr.onerror = () => reject({status: this.status, statusText: xhr.statusText});
		xhr.send();
	});
}

function isValidPZ(pz) {
	return Object.keys(ATTR_MAP).every((attr) => {
		const val = getAttrFromPZ(pz, attr);
		return val != undefined && val != NaN;
	});
}

function mergeRawPZs(resStrs) {
	return resStrs.reduce((acc, rawPZ) => {
		const pzs = JSON.parse(rawPZ)['data']['list'];
		acc.push(...pzs);
		return acc;
	}, []).filter(isValidPZ);
}

function fetchAllPZs(mount) {
	if (mount in PZ_CACHE) {
		return Promise.resolve(PZ_CACHE[mount]);
	}

	return getPromise(`https://cms.jx3box.com/api/cms/app/pz?per=${ENTRIES_PER_PAGE}&client=origin&valid=1&mount=${mount}`)
		.then((res) => JSON.parse(res)['data']['pages'])
		.then((pages) => Promise.all([...Array(pages).keys()].map((i) => {
			const page = i + 1; // jx3box pz pages are 1-indexed.
			return getPromise(`https://cms.jx3box.com/api/cms/app/pz?per=${ENTRIES_PER_PAGE}&page=${page}&client=origin&valid=1&mount=${mount}`);
		}))).then((rawPZs) => mergeRawPZs(rawPZs));
}

// ... so we don't repeat this everywhere.
function getAttrFromPZ(pz, attr) {
	return pz['overview']['attrs'][attr];
}


// Returns true iff the input `pz` meets the input `requirement`.
function meetsRequirement(pz, requirement) {
	return Object.entries(requirement).every(
		([attr, val]) => {
			return getAttrFromPZ(pz, attr) >= val;
		}
	);
}

// Returns true iff the input `pz` is not strictly worse than any pzs in `pzs`,
// based on the attributes to optimize in input `toOptimize`.
//
// Based on all the given `pzs`, it is no longer possible to increase one attr
// without losing another from the attrs we want to optimize.
function isParetoOptimal(pz, pzs, toOptimize) {
	return !(pzs.some(
		// True if `pz` is strictly worse than `pz2`.
		(pz2) => (toOptimize.length != 0) && toOptimize.every(
			(attr) => getAttrFromPZ(pz, attr) < getAttrFromPZ(pz2, attr)
		)
	));
}

// Find optimized PZs by filtering out PZs not meeting requirement, then find
// Pareto optimality. At least I think I'm getting the Pareto frontier, if I'm
// doing things correctly.
function optimizedPZs(pzs, requirement, toOptimize) {
	const filtered = pzs.filter((pz) => meetsRequirement(pz, requirement));
	if (toOptimize.length == 0) {
		return filtered;
	}
	return filtered.filter((pz) => isParetoOptimal(pz, filtered, toOptimize));
}

/// DOM Stuff, boring!!!

function renderLoader() {
	document.getElementById('loader').style.display = 'block';
}

function hideLoader() {
	document.getElementById('loader').style.display = 'none';
}

function clearResults() {
	const div = document.getElementById('results');
	while (div.firstChild) {
		div.removeChild(div.firstChild);
	}
}

function pzDiv(pz) {
	const div = document.createElement('div');
	div.classList.add('result-pz-div');

	const title = document.createElement('p');
	title.textContent = '配装名称：' + pz['title'] + ' ';
	const a = document.createElement('a');
	a.href = 'https://origin.jx3box.com/pz/view/' + pz['id'];
	a.textContent = 'https://origin.jx3box.com/pz/view/' + pz['id'];
	title.appendChild(a);
	div.appendChild(title);

	const score = document.createElement('p');
	score.textContent = '装分：' + pz['overview']['score'];
	div.appendChild(score);

	Object.entries(ATTR_MAP).forEach(([attr, displayName]) => {
		const p = document.createElement('p');
		p.textContent = `${displayName}: `;
		let val = getAttrFromPZ(pz, attr);
		if (attr.endsWith('Percent')) {
			val = (val * 100).toFixed(2) + '%';
		}
		p.textContent += val;
		div.appendChild(p);
	});

	return div;
}

function renderResults(pzs) {
	const div = document.getElementById('results');
	if (pzs.length == 0) {
		const p = document.createElement('p');
		p.textContent = '没有达标配装！'
		div.appendChild(p);
	}
	pzs.forEach((pz) => div.appendChild(pzDiv(pz)));
}

function getMount() {
	return document.getElementById('mount').value;
}

function getRequirement() {
	return Array.from(document.getElementById('requirement-wrapper').children)
		.filter((elm) => elm.tagName == 'INPUT' && !!elm.value)
		.map((elm) => [elm.id, elm.value])
		.reduce((acc, [k, v]) => {
			k = k.slice(0, k.length - 4); // remove '-req' suffix
			if (k.endsWith('Percent')) v /= 100;
			acc[k] = v;
			return acc;
		}, {});
}

function getOptimize() {
	return Array.from(document.getElementById('optimize-wrapper').children)
		.filter((elm) => elm.tagName == 'INPUT' && elm.checked)
		.map((elm) => elm.value);
}

function search() {
	clearResults();
	renderLoader();
	const mount = getMount();
	fetchAllPZs(mount).then((allPZs) => {
		PZ_CACHE[mount] = allPZs; // memoize
		const optimized = optimizedPZs(allPZs, getRequirement(), getOptimize());
		hideLoader();
		renderResults(optimized);
	});
}

// Because I'm lazy ...
function reset() {
	clearResults();
	Array.from(document.getElementById('requirement-wrapper').children)
		.filter((elm) => elm.tagName == 'INPUT' && !!elm.value)
		.forEach((elm) => elm.value = '');
	Array.from(document.getElementById('optimize-wrapper').children)
		.filter((elm) => elm.tagName == 'INPUT' && elm.checked)
		.forEach((elm) => elm.checked = false);
}
