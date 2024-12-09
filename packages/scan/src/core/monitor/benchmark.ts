const BENCHMARK_STORAGE_KEY = 'device_benchmark_result';
const BENCHMARK_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 1 week

export type BenchmarkResult = BenchmarkSuccessResult | BenchmarkInsufficientCoresResult;

interface BenchmarkSuccessResult {
  type: 'success';
  score: number;
  executionTime: number;
  opsPerSecond: {
    virtualDomOps: number;
  };
  jsEngine: string;
}

interface BenchmarkInsufficientCoresResult {
  type: 'insufficientCores';
  message: string;
  jsEngine: string;
}

interface StoredBenchmark extends BenchmarkSuccessResult {
  timestamp: number;
}

export async function getDevicePerformance(
  options: { timeout?: number; forceFresh?: boolean } = {}
): Promise<BenchmarkResult> {
  const { forceFresh = false } = options;

  const jsEngine = getJsEngine();

  const cores = navigator.hardwareConcurrency || 1;
  if (cores <= 1) {
    return {
      type: 'insufficientCores',
      message: 'Device has insufficient cores to run the benchmark.',
      jsEngine,
    };
  }

  try {
    const stored = localStorage.getItem(BENCHMARK_STORAGE_KEY);
    if (stored && !forceFresh) {
      const result: StoredBenchmark = JSON.parse(stored);
      if (Date.now() - result.timestamp < BENCHMARK_EXPIRY) {
        return result;
      }
    }
  } catch (e) {
  }

  const benchmarkData = await runBenchmark(options);

  const benchmarkResult: BenchmarkSuccessResult = {
    type: 'success',
    jsEngine,
    ...benchmarkData,
  };

  try {
    localStorage.setItem(BENCHMARK_STORAGE_KEY, JSON.stringify({
      ...benchmarkResult,
      timestamp: Date.now(),
    }));
  } catch (e) {
  }

  return benchmarkResult;
}

async function runBenchmark(
  options: { timeout?: number } = {}
): Promise<Omit<BenchmarkSuccessResult, 'type' | 'jsEngine'>> {
  const { timeout = 10000 } = options; 
  const blob = new Blob([workerScript], { type: 'application/javascript' });
  const workerUrl = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    let isWorkerReady = false;
    const worker = new Worker(workerUrl);

    const timeoutId = setTimeout(() => {
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      reject(new Error(`Benchmark timed out${!isWorkerReady ? ' (worker failed to initialize)' : ''}`));
    }, timeout);

    worker.onmessage = (e) => {
      if (e.data?.type === 'ready') {
        isWorkerReady = true;
        worker.postMessage({ type: 'start' });
        return;
      }

      if (e.data?.type === 'result') {
        clearTimeout(timeoutId);
        const result = e.data.data as Omit<BenchmarkSuccessResult, 'type' | 'jsEngine'>;
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
        resolve(result);
      }
    };

    worker.onerror = (error) => {
      clearTimeout(timeoutId);
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      reject(new Error(`Benchmark failed: ${error.message}`));
    };
  });
}

export function categorizeDevicePerformance(result: BenchmarkResult): 'low' | 'medium' | 'high' | 'unknown' {
  if (result.type !== 'success') {
    return 'unknown';
  }

  const opsPerSecond = result.opsPerSecond.virtualDomOps;

  if (opsPerSecond < 5000) {
    return 'low';
  } else if (opsPerSecond < 20000) {
    return 'medium';
  } else {
    return 'high';
  }
}

function getJsEngine(): string {
  const userAgent = navigator.userAgent;

  if (/Chrome|CriOS|CrMo/.test(userAgent) && !/Edge|Edg|OPR|Opera/.test(userAgent)) {
    return 'V8 (Chrome)';
  } else if (/Firefox/.test(userAgent)) {
    return 'SpiderMonkey (Firefox)';
  } else if (/Safari/.test(userAgent) && !/Chrome|CriOS|CrMo|Edge|Edg/.test(userAgent)) {
    return 'JavaScriptCore (Safari)';
  } else if (/Edg|Edge/.test(userAgent)) {
    return 'V8 (Edge)';
  } else if (/OPR|Opera/.test(userAgent)) {
    return 'V8 (Opera)';
  } else {
    return 'Unknown';
  }
}

const workerScript = `

  function createVNode(type, props, children) {
    return { type, props, children };
  }

  function diff(oldNode, newNode) {
    const patches = [];
    if (oldNode.type !== newNode.type) {
      patches.push({ type: 'REPLACE', node: newNode });
    } else {
      if (JSON.stringify(oldNode.props) !== JSON.stringify(newNode.props)) {
        patches.push({ type: 'PROPS', props: newNode.props });
      }
      diffChildren(oldNode.children, newNode.children, patches);
    }
    return patches;
  }

  function diffChildren(oldChildren, newChildren, patches) {
    const maxLength = Math.max(oldChildren.length, newChildren.length);
    for (let i = 0; i < maxLength; i++) {
      patches.push(diff(oldChildren[i], newChildren[i]));
    }
  }

  function updateVNode(vNode, newProps) {
    return { ...vNode, props: { ...vNode.props, ...newProps } };
  }

  function measureVirtualDomOps(totalTimeLimit, chunkTime, callback) {
    let ops = 0;
    let timeUsed = 0;

    function runChunk() {
      const chunkStartTime = performance.now();
      while (performance.now() - chunkStartTime < chunkTime) {
        // simulate tree init
        const tree1 = createVNode('div', { id: 'root' }, [
          createVNode('span', { className: 'text' }, [
            createVNode('text', { nodeValue: 'Hello' }, [])
          ]),
          createVNode('ul', {}, [
            createVNode('li', {}, [createVNode('text', { nodeValue: 'Item 1' }, [])]),
            createVNode('li', {}, [createVNode('text', { nodeValue: 'Item 2' }, [])]),
          ])
        ]);

        // simulate tree update
        const tree2 = updateVNode(tree1, { props: { id: 'root', className: 'container' } });

        // simulate tree diffing
        const patches = diff(tree1, tree2);

        ops++;
      }
      timeUsed += performance.now() - chunkStartTime;

      if (timeUsed < totalTimeLimit) {
        // this is so we don't take block the threads computation to have the least likely chance of affecting main thread performance (but likely doesn't make a difference)
        setTimeout(runChunk, 50);
      } else {
        const actualTime = timeUsed;
        callback({
          ops,
          opsPerSecond: Math.round((ops / actualTime) * 1000)
        });
      }
    }

    runChunk();
  }

  self.postMessage({ type: 'ready' });

  self.onmessage = function(e) {
    if (e.data?.type === 'start') {
      const TOTAL_TIME = 200; // 200ms total CPU time
      const CHUNK_TIME = 10; // Each chunk runs for 10ms

      measureVirtualDomOps(TOTAL_TIME, CHUNK_TIME, (result) => {
        const totalTime = TOTAL_TIME;
        const totalOps = result.ops;

        self.postMessage({
          type: 'result',
          data: {
            score: Math.round(totalOps), // Total ops as score
            executionTime: totalTime,
            opsPerSecond: {
              virtualDomOps: result.opsPerSecond
            }
          }
        });
      });
    }
  };
`;

