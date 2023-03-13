import { performance } from 'node:perf_hooks';

class PerformanceBenchmark {
  #events = new Set();

  start(id) {
    this.#events.add({
      id,
      type: 'start',
      now: performance.now(),
    });
  }

  stop(id) {
    this.#events.add({
      id,
      type: 'stop',
      now: performance.now(),
    });
  }

  stats(id = null, mode = 'full') {
    const groupEvents = [...this.#events.values()].reduce((accumulator, currentValue) => {
      return {
        ...accumulator,
        [currentValue.id]: {
          ...accumulator?.[currentValue.id],
          [currentValue.type]: [
            ...(accumulator[currentValue.id]?.[currentValue.type] ?? []),
            currentValue.now,
          ],
        },
      };
    }, {});

    const stats = Object.entries(groupEvents).reduce((accumulator, [key, value]) => {
      const count = value.start.length;
      const samples = value.stop.map((item, index) => ({
        start: value.start[index],
        stop: item,
        duration: item - value.start[index],
      }));
      const samplesMap = samples.map(i => i.duration);
      const max = Math.max(...samplesMap);
      const min = Math.min(...samplesMap);
      const mean = samplesMap.reduce((a, b) => a + b, 0) / count;
      const stddev = Math.sqrt(
        samplesMap.reduce((sum, sample) => sum + (sample - mean) ** 2, 0) / count,
      );

      return {
        ...accumulator,
        [key]: {
          id: key,
          count,
          samples: mode === 'full' ? samples : '',
          max,
          min,
          mean,
          stddev,
        },
      };
    }, {});

    return id ? stats[id] : stats;
  }

  reset() {
    this.#events.clear();
  }
}

// ignore unused exports
export default PerformanceBenchmark;
