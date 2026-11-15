// Samples for the Sampler module. A patch names its sample; the sound itself stays in this
// browser's IndexedDB, because it is far too big for the patch.
// A sample is { name, sampleRate, audioBuffer: [Float32Array] }, the shape faustwasm reads.

const MAX_SECONDS = 10;

const store = () =>
	new Promise((done, fail) => {
		const open = indexedDB.open("faust-rack", 1);
		open.onupgradeneeded = () => open.result.createObjectStore("samples");
		open.onsuccess = () => done(open.result.transaction("samples", "readwrite").objectStore("samples"));
		open.onerror = () => fail(open.error);
	});
const request = (req) => new Promise((done, fail) => ((req.onsuccess = () => done(req.result)), (req.onerror = () => fail(req.error))));

export const loadSample = async (name) => (await request((await store()).get(name))) ?? null;

// Decodes an audio file to one channel of at most ten seconds and keeps it under its file name.
export async function importSample(ctx, file) {
	const audio = await ctx.decodeAudioData(await file.arrayBuffer());
	const frames = Math.min(audio.length, MAX_SECONDS * audio.sampleRate);
	const mono = new Float32Array(frames);
	for (let channel = 0; channel < audio.numberOfChannels; channel++) {
		const data = audio.getChannelData(channel);
		for (let i = 0; i < frames; i++) mono[i] += data[i] / audio.numberOfChannels;
	}
	const sample = { name: file.name, sampleRate: audio.sampleRate, audioBuffer: [mono] };
	await request((await store()).put(sample, sample.name));
	return sample;
}

// What a Sampler plays before it gets a file: a small bell at C4, so pitch 0 is in tune.
export function bell(sampleRate) {
	const data = new Float32Array(Math.round(sampleRate * 1.5));
	const partials = [[1, 1, 0.5], [2.76, 0.5, 0.25], [5.4, 0.25, 0.12], [8.93, 0.12, 0.06]];
	for (let i = 0; i < data.length; i++) {
		const t = i / sampleRate;
		for (const [ratio, gain, decay] of partials) data[i] += Math.sin(2 * Math.PI * 261.63 * ratio * t) * gain * Math.exp(-t / decay) * 0.5;
	}
	return { name: "", sampleRate, audioBuffer: [data] };
}
