import { BoundedArray } from 'src/core/monitor/performance-utils';
import {
  InternalInteraction,
  PerformanceInteraction,
} from 'src/core/monitor/types';

// forgot why start time was here ngl
type Item = any;
type UnSubscribe = () => void;
type Callback = (item: Item) => void;
type Updater = (state: BoundedArray<Item>) => BoundedArray<Item>;
type ChanelName = string;

type PerformanceEntryChannelsType = {
  subscribe: (to: ChanelName, cb: Callback) => UnSubscribe;
  publish: (
    item: Item,
    to: ChanelName,
    dropFirst: boolean,
    createIfNoChannel: boolean,
  ) => void;
  channels: Record<
    ChanelName,
    { callbacks: BoundedArray<Callback>; state: BoundedArray<Item> }
  >;
  getAvailableChannels: () => BoundedArray<string>;
  updateChannelState: (
    channel: ChanelName,
    updater: Updater,
    createIfNoChannel: boolean,
  ) => void;
};

export const MAX_CHANNEL_SIZE = 50
// a set of entities communicate to each other through channels
// the state in the channel is persisted until the receiving end consumes it
// multiple subscribes to the same channel will likely lead to unintended behavior if the subscribers are separate entities
class PerformanceEntryChannels implements PerformanceEntryChannelsType {
  channels: PerformanceEntryChannelsType['channels'] = {};
  publish(item: Item, to: ChanelName, createIfNoChannel = true) {
    const existingChannel = this.channels[to];
    if (!existingChannel) {
      if (!createIfNoChannel) {
        return;
      }
      this.channels[to] = {
        callbacks: new BoundedArray<Callback>(MAX_CHANNEL_SIZE),
        state: new BoundedArray<Item>(MAX_CHANNEL_SIZE),
      };
      this.channels[to].state.push(item);
      return;
    }

    existingChannel.state.push(item);
    existingChannel.callbacks.forEach((cb) => cb(item));
  }

  getAvailableChannels() {
    return BoundedArray.fromArray(Object.keys(this.channels), MAX_CHANNEL_SIZE);
  }
  subscribe(to: ChanelName, cb: Callback, dropFirst: boolean = false) {
    const defer = () => {
      if (!dropFirst) {
        this.channels[to].state.forEach((item) => {
          cb(item);
        });
      }
      return () => {
        const filtered = this.channels[to].callbacks.filter(
          (subscribed) => subscribed !== cb
        );
        this.channels[to].callbacks = BoundedArray.fromArray(filtered, MAX_CHANNEL_SIZE);
      };
    };
    const existing = this.channels[to];
    if (!existing) {
      this.channels[to] = {
        callbacks: new BoundedArray<Callback>(MAX_CHANNEL_SIZE),
        state: new BoundedArray<Item>(MAX_CHANNEL_SIZE),
      };
      this.channels[to].callbacks.push(cb);
      return defer();
    }

    existing.callbacks.push(cb);
    return defer();
  }
  updateChannelState(
    channel: ChanelName,
    updater: Updater,
    createIfNoChannel = true,
  ) {
    const existingChannel = this.channels[channel];
    if (!existingChannel) {
      if (!createIfNoChannel) {
        return;
      }

      const state = new BoundedArray<Item>(MAX_CHANNEL_SIZE)
      const newChannel = { callbacks: new BoundedArray<Item>(MAX_CHANNEL_SIZE), state };

      this.channels[channel] = newChannel;
      newChannel.state = updater(state);
      return;
    }

    existingChannel.state = updater(existingChannel.state);
  }

  getChannelState(channel: ChanelName) {
    return this.channels[channel].state ?? new BoundedArray<Item>(MAX_CHANNEL_SIZE);
  }
}

export const performanceEntryChannels = new PerformanceEntryChannels();
