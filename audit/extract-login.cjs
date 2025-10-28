const fs = require('fs');
const path = require('path');

function fileExists(p) {
	try { fs.accessSync(p); return true; } catch { return false; }
}

function readJson(p) {
	return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function toScore(v) {
	return typeof v === 'number' ? Math.round(v * 100) : null;
}

function extractRun(json) {
	const categories = json.categories || {};
	const audits = json.audits || {};
	let metricsItem = null;
	try { metricsItem = audits.metrics?.details?.items?.[0] || null; } catch {}

	const getNum = (key) => {
		const a = audits[key];
		if (!a) return null;
		if (typeof a.numericValue === 'number') return a.numericValue;
		return null;
	};

	const LCP = metricsItem?.observedLargestContentfulPaint ?? getNum('largest-contentful-paint');
	const CLS = metricsItem?.observedCumulativeLayoutShift ?? getNum('cumulative-layout-shift');
	const TBT = metricsItem?.observedTotalBlockingTime ?? getNum('total-blocking-time');
	const FCP = metricsItem?.observedFirstContentfulPaint ?? getNum('first-contentful-paint');
	const INP = metricsItem?.observedInteractionToNextPaint ?? getNum('interaction-to-next-paint');

	return {
		LCP_ms: Number.isFinite(LCP) ? Math.round(LCP) : null,
		CLS: Number.isFinite(CLS) ? Math.round(CLS * 1000) / 1000 : null,
		TBT_ms: Number.isFinite(TBT) ? Math.round(TBT) : null,
		FCP_ms: Number.isFinite(FCP) ? Math.round(FCP) : null,
		INP_ms: Number.isFinite(INP) ? Math.round(INP) : null,
		scores: {
			performance: toScore(categories.performance?.score),
			accessibility: toScore(categories.accessibility?.score),
			seo: toScore(categories.seo?.score),
			'best-practices': toScore(categories['best-practices']?.score),
		},
	};
}

function pickMedianByLcp(runs) {
	const lcps = runs.map(r => (typeof r.LCP_ms === 'number' ? r.LCP_ms : Number.POSITIVE_INFINITY));
	const finite = lcps.filter(n => Number.isFinite(n));
	if (finite.length === 0) return 0;
	const avg = finite.reduce((a,b)=>a+b,0) / finite.length;
	let idx = 0;
	let best = Number.POSITIVE_INFINITY;
	for (let i = 0; i < lcps.length; i++) {
		const d = Math.abs(lcps[i] - avg);
		if (d < best) { best = d; idx = i; }
	}
	return idx;
}

(function main() {
	const base = path.join(process.cwd(), 'audit', 'lighthouse');
	const files = {
		mobile: [
			path.join(base, 'login-mobile-1.json'),
			path.join(base, 'login-mobile-2.json'),
		],
		desktop: [
			path.join(base, 'login-desktop-1.json'),
			path.join(base, 'login-desktop-2.json'),
		],
	};

	const mobileRuns = files.mobile.filter(fileExists).map(readJson).map(extractRun);
	const desktopRuns = files.desktop.filter(fileExists).map(readJson).map(extractRun);

	const mi = mobileRuns.length ? pickMedianByLcp(mobileRuns) : 0;
	const di = desktopRuns.length ? pickMedianByLcp(desktopRuns) : 0;

	const out = {
		page: '/login',
		mobile: {
			runs: mobileRuns,
			medianByLCPIndex: mi,
			representative: mobileRuns[mi] || null,
		},
		desktop: {
			runs: desktopRuns,
			medianByLCPIndex: di,
			representative: desktopRuns[di] || null,
		},
	};

	const outPath = path.join(base, 'login-summary.json');
	fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
	process.stdout.write(JSON.stringify(out));
})();
