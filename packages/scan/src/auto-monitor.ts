import 'bippy'; // implicit init RDT hook
import { Store } from 'src';
import { scanMonitoring } from 'src/core/monitor';
// import { initPerformanceMonitoring } from 'src/core/monitor/performance';
import { Device } from 'src/core/monitor/types';

if (typeof window !== 'undefined') {
  Store.monitor.value ??= {
    pendingRequests: 0,
    interactions: [],
    session: new Promise((res) =>
      res({
        agent: 'mock',
        branch: 'mock',
        commit: 'mock',
        cpu: -1,
        device: Device.DESKTOP,
        gpu: null,
        id: 'mock',
        mem: -1,
        route: 'mock',
        url: 'mock',
        wifi: 'mock',
      }),
    ),
    url: 'https://mock.com',
    apiKey: '<mock-key>',
    route: '<mock-route>',
    commit: '<mock-commit>',
    branch: '<mock-branch>',
    interactionListeningForRenders: null,
  };
  // scanMonitoring({
  //   enabled: true,
  // });
  // initPerformanceMonitoring();
}
