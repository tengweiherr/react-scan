import { type Fiber } from 'react-reconciler';
import { getType } from 'bippy';
import { ReactScanInternals } from '..';
import type { Render } from './instrumentation';

export const getLabelText = (renders: Array<Render>) => {
  let labelText = '';

  const components = new Map<
    string,
    {
      count: number;
      forget: boolean;
      time: number;
    }
  >();

  for (let i = 0, len = renders.length; i < len; i++) {
    const render = renders[i];
    const name = render.name;
    if (!name?.trim()) continue;

    const { count, forget, time } = components.get(name) ?? {
      count: 0,
      forget: false,
      time: 0,
    };
    components.set(name, {
      count: count + render.count,
      forget: forget || render.forget,
      time: time + render.time,
    });
  }

  const sortedComponents = Array.from(components.entries()).sort(
    ([, a], [, b]) => b.count - a.count,
  );

  const parts: Array<string> = [];
  for (const [name, { count, forget, time }] of sortedComponents) {
    let text = name;
    if (count > 1) {
      text += ` ×${count}`;
    }
    if (time >= 0.01 && count > 0) {
      text += ` (${time.toFixed(2)}ms)`;
    }

    if (forget) {
      text = `${text} ✨`;
    }
    parts.push(text);
  }

  labelText = parts.join(' ');

  if (!labelText.length) return null;
  if (labelText.length > 40) {
    labelText = `${labelText.slice(0, 40)}…`;
  }
  return labelText;
};

export const updateFiberRenderData = (fiber: Fiber, renders: Array<Render>) => {
  ReactScanInternals.options.value.onRender?.(fiber, renders);
  const type = getType(fiber.type) || fiber.type;
  if (type && typeof type === 'function' && typeof type === 'object') {
    const renderData = (type.renderData || {
      count: 0,
      time: 0,
      renders: [],
    }) as RenderData;
    const firstRender = renders[0];
    renderData.count += firstRender.count;
    renderData.time += firstRender.time;
    renderData.renders.push(firstRender);
    type.renderData = renderData;
  }
};

export interface RenderData {
  count: number;
  time: number;
  renders: Array<Render>;
  displayName: string | null;
  type: React.ComponentType<any> | null;
}
