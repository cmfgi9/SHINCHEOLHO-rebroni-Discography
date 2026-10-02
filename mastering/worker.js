/* Rebroni Mastering Worker — 분석·마스터링을 화면과 분리된 스레드에서 실행합니다. */
importScripts("dsp.js?v=1");

let source = null; // { chs: [L, R], fs } — 원본은 한 번만 받아 두고 매번 복사해 처리

self.onmessage = (e) => {
  const { type, id } = e.data;
  try {
    if (type === "load") {
      source = { chs: e.data.chs, fs: e.data.fs };
      self.postMessage({ type: "analysis", id, analysis: RDSP.analyze(source.chs, source.fs) });
    } else if (type === "analyzeRef") {
      self.postMessage({ type: "analysis", id, analysis: RDSP.analyze(e.data.chs, e.data.fs) });
    } else if (type === "master") {
      if (!source) throw new Error("음원이 없습니다.");
      const res = RDSP.master(source.chs, source.fs, e.data.params,
        (label, pct) => self.postMessage({ type: "progress", id, label, pct }));
      self.postMessage({ type: "mastered", id, chs: res.chs, analysis: res.analysis, stats: res.stats },
        res.chs.map((c) => c.buffer));
    }
  } catch (err) {
    self.postMessage({ type: "error", id, message: String((err && err.message) || err) });
  }
};
