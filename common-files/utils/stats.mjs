/* ignore unused exports */
import PerformanceBenchmark from './performance-benchmark.mjs';

const pm = new PerformanceBenchmark();
let label = [];
const { PERFORMANCE_BENCHMARK_ENABLE } = process.env;

export function start(id) {
  if (PERFORMANCE_BENCHMARK_ENABLE !== 'true') return;
  if (!label.includes(id)) label.push(id);
  pm.start(id);
}

export function stop(id) {
  if (PERFORMANCE_BENCHMARK_ENABLE !== 'true') return;
  if (!label.includes(id)) label.push(id);
  pm.stop(id);
}

export function stats() {
  if (PERFORMANCE_BENCHMARK_ENABLE !== 'true') return {};
  const result = [];
  for (const l of label) {
    result.push(pm.stats(l, 'short'));
  }
  return result;
}

export function reset() {
  if (PERFORMANCE_BENCHMARK_ENABLE !== 'true') return;
  label = [];
  pm.reset();
}
