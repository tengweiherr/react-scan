import { type Fiber } from 'react-reconciler';

export enum Device {
  DESKTOP = 0,
  TABLET = 1,
  MOBILE = 2,
}

export interface Session {
  id: string;
  device: Device;
  agent: string;
  wifi: string;
  cpu: number;
  gpu: string | null;
  mem: number;
  url: string;
  route: string | null;
  commit: string | null;
  branch: string | null;
}

export interface Interaction {
  id: string | number; // index of the interaction in the batch at ingest | server converts to a hashed string from route, type, name, path
  path: Array<string>; // the path of the interaction
  name: string; // name of interaction
  type: string; // type of interaction i.e pointer
  time: number; // time of interaction in ms
  timestamp: number;
  url: string;
  route: string | null; // the computed route that handles dynamic params

  // Regression tracking
  commit: string | null;
  branch: string | null;

  interactionStartAt: number;
  interactionEndAt: number;

  componentRenderData: Record<
    string,
    {
      renderCount: number;
      parents: Array<string>;
      selfTime?: number | null;
      // totalTime: number;
    }
  >;

  // clickhouse + ingest specific types
  projectId?: string;
  sessionId?: string;
  uniqueInteractionId: string;

  meta?: {
    performanceEntry: {
      id: string;
      inputDelay: number;
      latency: number;
      presentationDelay: number;
      processingDuration: number;
      processingEnd: number;
      processingStart: number;
      referrer: string;
      startTime: number;
      timeOrigin: number;
      timeSinceTabInactive: number | 'never-hidden';
      visibilityState: DocumentVisibilityState;
      duration: number;
      entries: Array<{
        duration: number;
        entryType: string;
        interactionId: string;
        name: string;
        processingEnd: number;
        processingStart: number;
        startTime: number;
      }>;
      detailedTiming?: {
        jsHandlersTime: number;
        prePaintTime: number;
        paintTime: number;
        compositorTime: number;
      };
    };
  };
}

export interface Component {
  interactionId: string | number; // grouping components by interaction
  name: string;
  renders: number; // how many times it re-rendered / instances (normalized)
  instances: number; // instances which will be used to get number of total renders by * by renders
  totalTime?: number;
  selfTime?: number;
}

export interface IngestRequest {
  interactions: Array<Interaction>;
  components: Array<Component>;
  session: Session;
}

// used internally in runtime for interaction tracking. converted to Interaction when flushed
export interface InternalInteraction {
  performanceEntry: PerformanceInteraction,
  route:string,
  url:string,
  branch: string,
  commit: string,
}
interface InternalComponentCollection {
  uniqueInteractionId: string;
  name: string;
  renders: number; // re-renders associated with the set of components in this collection
  totalTime?: number;
  selfTime?: number;
  fibers: Set<Fiber>; // no references will exist to this once array is cleared after flush, so we don't have to worry about memory leaks
  retiresAllowed: number; // if our server is down and we can't collect fibers/ user has no network, it will memory leak. We need to only allow a set amount of retries before it gets gcd
}

export interface PerformanceInteractionEntry extends PerformanceEntry {
  interactionId: string;
  target: Element;
  name: string;
  duration: number;
  startTime: number;
  processingStart: number;
  processingEnd: number;
  entryType: string;
}
export interface PerformanceInteraction {
  id: string;
  latency: number;
  entries: Array<PerformanceInteractionEntry>;
  target: Element | null;
  type: 'pointer' | 'keyboard';
  startTime: number;
  endTime: number;
  processingStart: number;
  processingEnd: number;
  duration: number;
  inputDelay: number;
  processingDuration: number;
  presentationDelay: number;
  timestamp: number;
  timeSinceTabInactive: number | 'never-hidden';
  visibilityState: DocumentVisibilityState;
  timeOrigin: number;
  referrer: string;
  // Detailed timing breakdown
  detailedTiming?: {
    jsHandlersTime: number; // pointerup -> click
    prePaintTime: number; // click -> RAF
    paintTime: number; // RAF -> setTimeout
    compositorTime: number; // remaining duration
  };
}
