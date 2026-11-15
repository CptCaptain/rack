// Records what the rack plays. The browser's recorder writes a compressed stream. It is
// decoded once at the end and saved as a WAV file, because every audio program opens WAV.
export const MAX_RECORDING_MINUTES = 15;

export function startRecording(ctx, source) {
	const tap = ctx.createMediaStreamDestination();
	source.connect(tap);
	const recorder = new MediaRecorder(tap.stream, { audioBitsPerSecond: 256000 });
	const chunks = [];
	recorder.ondataavailable = (e) => chunks.push(e.data);
	recorder.start();
	return async function stop() {
		await new Promise((done) => {
			recorder.onstop = done;
			recorder.stop();
		});
		source.disconnect(tap);
		return wav(await ctx.decodeAudioData(await new Blob(chunks).arrayBuffer()));
	};
}

// 16-bit PCM, the plainest WAV there is.
function wav(audio) {
	const channels = audio.numberOfChannels;
	const bytes = audio.length * channels * 2;
	const view = new DataView(new ArrayBuffer(44 + bytes));
	const text = (at, string) => [...string].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
	text(0, "RIFF");
	view.setUint32(4, 36 + bytes, true);
	text(8, "WAVEfmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, channels, true);
	view.setUint32(24, audio.sampleRate, true);
	view.setUint32(28, audio.sampleRate * channels * 2, true);
	view.setUint16(32, channels * 2, true);
	view.setUint16(34, 16, true);
	text(36, "data");
	view.setUint32(40, bytes, true);
	const data = Array.from({ length: channels }, (_, channel) => audio.getChannelData(channel));
	for (let frame = 0, at = 44; frame < audio.length; frame++)
		for (let channel = 0; channel < channels; channel++, at += 2) view.setInt16(at, Math.max(-1, Math.min(1, data[channel][frame])) * 32767, true);
	return new Blob([view], { type: "audio/wav" });
}
