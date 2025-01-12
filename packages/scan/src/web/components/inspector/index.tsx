import { signal } from '@preact/signals';
import { type Fiber, getDisplayName } from 'bippy';
import { Component } from 'preact';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import { Store } from '~core/index';
import { isEqual } from '~core/utils';
import { CopyToClipboard } from '~web/components/copy-to-clipboard';
import { Icon } from '~web/components/icon';
import { signalIsSettingsOpen } from '~web/state';
import { cn, tryOrElse } from '~web/utils/helpers';
import { constant } from '~web/utils/preact/constant';
import { flashManager } from './flash-overlay';
import {
  type InspectorData,
  collectInspectorData,
  ensureRecord,
  getContextChangeCount,
  getCurrentFiberState,
  getPropsChangeCount,
  getStateChangeCount,
  getStateNames,
  isPromise,
  resetStateTracking,
} from './overlay/utils';
import { getCompositeFiberFromElement, getOverrideMethods } from './utils';

interface InspectorState extends InspectorData {
  fiber: Fiber | null;
}

type InspectableValue =
  | Record<string, unknown>
  | Array<unknown>
  | Map<unknown, unknown>
  | Set<unknown>
  | ArrayBuffer
  | DataView
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array;

interface PropertyElementProps {
  name: string;
  value: unknown | ValueMetadata;
  section: string;
  level: number;
  parentPath?: string;
  objectPathMap?: WeakMap<object, Set<string>>;
  changedKeys?: Set<string>;
  allowEditing?: boolean;
}

interface PropertySectionProps {
  title: string;
  section: 'props' | 'state' | 'context';
}

interface EditableValueProps {
  value: unknown;
  onSave: (newValue: unknown) => void;
  onCancel: () => void;
}

interface ValueMetadata {
  type: string;
  displayValue: string;
  value?: unknown;
  size?: number;
  length?: number;
  byteLength?: number;
  entries?: Record<string, ValueMetadata>;
  items?: Array<ValueMetadata>;
}

const globalInspectorState = {
  lastRendered: new Map<string, unknown>(),
  expandedPaths: new Set<string>(),
  cleanup: () => {
    globalInspectorState.lastRendered.clear();
    globalInspectorState.expandedPaths.clear();
    flashManager.cleanupAll();
    resetStateTracking();
    inspectorState.value = {
      fiber: null,
      fiberProps: { current: {}, changes: new Set() },
      fiberState: { current: {}, changes: new Set() },
      fiberContext: { current: {}, changes: new Set() },
    };
  },
};

const inspectorState = signal<InspectorState>({
  fiber: null,
  fiberProps: { current: {}, changes: new Set() },
  fiberState: { current: {}, changes: new Set() },
  fiberContext: { current: {}, changes: new Set() },
});

class InspectorErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

const isExpandable = (value: unknown): value is InspectableValue => {
  if (value === null || typeof value !== 'object' || isPromise(value)) {
    return false;
  }

  if (value instanceof ArrayBuffer) {
    return true;
  }

  if (value instanceof DataView) {
    return true;
  }

  if (ArrayBuffer.isView(value)) {
    return true;
  }

  if (value instanceof Map || value instanceof Set) {
    return value.size > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return Object.keys(value).length > 0;
};

const isEditableValue = (value: unknown, parentPath?: string): boolean => {
  if (value == null) return true;

  if (isPromise(value)) return false;

  if (typeof value === 'function') {
    return false;
  }

  if (parentPath) {
    const parts = parentPath.split('.');
    let currentPath = '';
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}.${part}` : part;
      const obj = globalInspectorState.lastRendered.get(currentPath);
      if (
        obj instanceof DataView ||
        obj instanceof ArrayBuffer ||
        ArrayBuffer.isView(obj)
      ) {
        return false;
      }
    }
  }

  switch (value.constructor) {
    case Date:
    case RegExp:
    case Error:
      return true;
    default:
      switch (typeof value) {
        case 'string':
        case 'number':
        case 'boolean':
        case 'bigint':
          return true;
        default:
          return false;
      }
  }
};

const getPath = (
  componentName: string,
  section: string,
  parentPath: string,
  key: string,
): string => {
  if (parentPath) {
    return `${componentName}.${parentPath}.${key}`;
  }

  if (section === 'context' && !key.startsWith('context.')) {
    return `${componentName}.${section}.context.${key}`;
  }

  return `${componentName}.${section}.${key}`;
};

const sanitizeString = (value: string): string => {
  return value
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/data:/gi, '')
    .replace(/on\w+=/gi, '')
    .slice(0, 50000);
};

const sanitizeErrorMessage = (error: string): string => {
  return error
    .replace(/[<>]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
};

const formatValue = (value: unknown): string => {
  const metadata = ensureRecord(value);
  return metadata.displayValue as string;
};

const formatForClipboard = (value: unknown): string => {
  try {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (isPromise(value)) return 'Promise';

    if (typeof value === 'function') {
      const fnStr = value.toString();
      try {
        const formatted = fnStr
          .replace(/\s+/g, ' ') // Normalize whitespace
          .replace(/{\s+/g, '{\n  ') // Add newline after {
          .replace(/;\s+/g, ';\n  ') // Add newline after ;
          .replace(/}\s*$/g, '\n}') // Add newline before final }
          .replace(/\(\s+/g, '(') // Remove space after (
          .replace(/\s+\)/g, ')') // Remove space before )
          .replace(/,\s+/g, ', '); // Normalize comma spacing

        return formatted;
      } catch {
        return fnStr;
      }
    }

    switch (true) {
      case value instanceof Date:
        return value.toISOString();
      case value instanceof RegExp:
        return value.toString();
      case value instanceof Error:
        return `${value.name}: ${value.message}`;
      case value instanceof Map:
        return JSON.stringify(Array.from(value.entries()), null, 2);
      case value instanceof Set:
        return JSON.stringify(Array.from(value), null, 2);
      case value instanceof DataView:
        return JSON.stringify(
          Array.from(new Uint8Array(value.buffer)),
          null,
          2,
        );
      case value instanceof ArrayBuffer:
        return JSON.stringify(Array.from(new Uint8Array(value)), null, 2);
      case ArrayBuffer.isView(value) && 'length' in value:
        return JSON.stringify(
          Array.from(value as unknown as ArrayLike<number>),
          null,
          2,
        );
      case Array.isArray(value):
        return JSON.stringify(value, null, 2);
      case typeof value === 'object':
        return JSON.stringify(value, null, 2);
      default:
        return String(value);
    }
  } catch {
    return String(value);
  }
};

const parseArrayValue = (value: string): Array<unknown> => {
  if (value.trim() === '[]') return [];

  const result: Array<unknown> = [];
  let current = '';
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < value.length; i++) {
    const char = value[i];

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
    }

    if (char === '"') {
      inString = !inString;
      current += char;
      continue;
    }

    if (inString) {
      current += char;
      continue;
    }

    if (char === '[' || char === '{') {
      depth++;
      current += char;
      continue;
    }

    if (char === ']' || char === '}') {
      depth--;
      current += char;
      continue;
    }

    if (char === ',' && depth === 0) {
      if (current.trim()) {
        result.push(parseValue(current.trim(), ''));
      }
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    result.push(parseValue(current.trim(), ''));
  }

  return result;
};

const parseValue = (value: string, currentType: unknown): unknown => {
  try {
    switch (typeof currentType) {
      case 'number':
        return Number(value);
      case 'string':
        return value;
      case 'boolean':
        return value === 'true';
      case 'bigint':
        return BigInt(value);
      case 'undefined':
        return undefined;
      case 'object': {
        if (!currentType) {
          return null;
        }

        if (Array.isArray(currentType)) {
          return parseArrayValue(value.slice(1, -1));
        }

        if (currentType instanceof RegExp) {
          try {
            const match = /^\/(?<pattern>.*)\/(?<flags>[gimuy]*)$/.exec(value);
            if (match?.groups) {
              return new RegExp(match.groups.pattern, match.groups.flags);
            }
            return new RegExp(value);
          } catch {
            return currentType;
          }
        }

        if (currentType instanceof Map) {
          const entries = value
            .slice(1, -1)
            .split(', ')
            .map((entry) => {
              const [key, val] = entry.split(' => ');
              return [parseValue(key, ''), parseValue(val, '')] as [
                unknown,
                unknown,
              ];
            });
          return new Map(entries);
        }

        if (currentType instanceof Set) {
          const values = value
            .slice(1, -1)
            .split(', ')
            .map((v) => parseValue(v, ''));
          return new Set(values);
        }
        const entries = value
          .slice(1, -1)
          .split(', ')
          .map((entry) => {
            const [key, val] = entry.split(': ');
            return [key, parseValue(val, '')];
          });
        return Object.fromEntries(entries);
      }
    }

    return value;
  } catch {
    return currentType;
  }
};

const detectValueType = (
  value: string,
): {
  type: 'string' | 'number' | 'undefined' | 'null' | 'boolean';
  value: unknown;
} => {
  const trimmed = value.trim();

  switch (trimmed) {
    case 'undefined':
      return { type: 'undefined', value: undefined };
    case 'null':
      return { type: 'null', value: null };
    case 'true':
      return { type: 'boolean', value: true };
    case 'false':
      return { type: 'boolean', value: false };
  }

  if (/^".*"$/.test(trimmed)) {
    return { type: 'string', value: trimmed.slice(1, -1) };
  }

  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return { type: 'number', value: Number(trimmed) };
  }

  return { type: 'string', value: `"${trimmed}"` };
};

const formatInitialValue = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return `"${value}"`;
  return String(value);
};

const EditableValue = ({ value, onSave, onCancel }: EditableValueProps) => {
  const refInput = useRef<HTMLInputElement>(null);
  const [editValue, setEditValue] = useState('');

  useEffect(() => {
    let initialValue = '';
    try {
      if (value instanceof Date) {
        initialValue = value.toISOString().slice(0, 16);
      } else if (
        value instanceof Map ||
        value instanceof Set ||
        value instanceof RegExp ||
        value instanceof Error ||
        value instanceof ArrayBuffer ||
        ArrayBuffer.isView(value) ||
        (typeof value === 'object' && value !== null)
      ) {
        initialValue = formatValue(value);
      } else {
        initialValue = formatInitialValue(value);
      }
    } catch {
      initialValue = String(value);
    }
    const sanitizedValue = sanitizeString(initialValue);
    setEditValue(sanitizedValue);

    requestAnimationFrame(() => {
      if (!refInput.current) return;
      refInput.current.focus();
      if (typeof value === 'string') {
        refInput.current.setSelectionRange(1, sanitizedValue.length - 1);
      } else {
        refInput.current.select();
      }
    });
  }, [value]);

  const handleChange = useCallback((e: Event) => {
    const target = e.target as HTMLInputElement;
    if (target) {
      setEditValue(target.value);
    }
  }, []);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      try {
        let newValue: unknown;
        if (value instanceof Date) {
          const date = new Date(editValue);
          if (Number.isNaN(date.getTime())) {
            throw new Error('Invalid date');
          }
          newValue = date;
        } else {
          const detected = detectValueType(editValue);
          newValue = detected.value;
        }
        onSave(newValue);
      } catch {
        onCancel();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      onCancel();
    }
  };

  return (
    <input
      ref={refInput}
      type={value instanceof Date ? 'datetime-local' : 'text'}
      className="react-scan-input flex-1"
      value={editValue}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlur={onCancel}
      step={value instanceof Date ? 1 : undefined}
    />
  );
};

const updateNestedValue = (
  obj: unknown,
  path: Array<string>,
  value: unknown,
): unknown => {
  try {
    if (path.length === 0) return value;

    const [key, ...rest] = path;

    if (obj instanceof Map) {
      const newMap = new Map(obj);
      if (rest.length === 0) {
        newMap.set(key, value);
      } else {
        const currentValue = newMap.get(key);
        newMap.set(key, updateNestedValue(currentValue, rest, value));
      }
      return newMap;
    }

    if (Array.isArray(obj)) {
      const index = Number.parseInt(key, 10);
      const newArray = [...obj];
      if (rest.length === 0) {
        newArray[index] = value;
      } else {
        newArray[index] = updateNestedValue(obj[index], rest, value);
      }
      return newArray;
    }

    if (obj && typeof obj === 'object') {
      // TODO Megamorphic code
      if (rest.length === 0) {
        return { ...obj, [key]: value };
      }
      return {
        ...obj,
        [key]: updateNestedValue(
          (obj as Record<string, unknown>)[key],
          rest,
          value,
        ),
      };
    }

    return value;
  } catch {
    return obj;
  }
};

const PropertyElement = ({
  name,
  value,
  section,
  level,
  parentPath,
  objectPathMap = new WeakMap(),
  changedKeys = new Set(),
  allowEditing = true,
}: PropertyElementProps) => {
  const { fiber } = inspectorState.value;
  const refElement = useRef<HTMLDivElement>(null);

  const currentPath = getPath(
    (fiber?.type && getDisplayName(fiber.type)) ?? 'Unknown',
    section,
    parentPath ?? '',
    name,
  );
  const [isExpanded, setIsExpanded] = useState(
    globalInspectorState.expandedPaths.has(currentPath),
  );
  const [isEditing, setIsEditing] = useState(false);

  const prevValue = globalInspectorState.lastRendered.get(currentPath);
  const isChanged = !isEqual(prevValue, value);

  useEffect(() => {
    return () => {
      if (refElement.current) {
        flashManager.cleanup(refElement.current);
      }
    };
  }, []);

  useEffect(() => {
    globalInspectorState.lastRendered.set(currentPath, value);

    const isFirstRender = !globalInspectorState.lastRendered.has(currentPath);
    const shouldFlash =
      isChanged &&
      refElement.current &&
      !isFirstRender;

    if (shouldFlash && refElement.current && level === 0) {
      flashManager.create(refElement.current);
    }
  }, [value, isChanged, currentPath, level]);

  const handleToggleExpand = useCallback(() => {
    setIsExpanded((prevState: boolean) => {
      const newIsExpanded = !prevState;
      if (newIsExpanded) {
        globalInspectorState.expandedPaths.add(currentPath);
      } else {
        globalInspectorState.expandedPaths.delete(currentPath);
      }
      return newIsExpanded;
    });
  }, [currentPath]);

  const valuePreview = useMemo(() => {
    if (typeof value === 'object' && value !== null) {
      if ('displayValue' in value) {
        return String(value.displayValue);
      }
    }
    return formatValue(value);
  }, [value]);

  const clipboardText = useMemo(() => {
    if (typeof value === 'object' && value !== null) {
      if ('value' in value) {
        return String(formatForClipboard(value.value));
      }
      if ('displayValue' in value) {
        return String(value.displayValue);
      }
    }
    return String(formatForClipboard(value));
  }, [value]);

  const isExpandableValue = useMemo(() => {
    if (!value || typeof value !== 'object') return false;

    if ('type' in value) {
      const metadata = value as ValueMetadata;
      switch (metadata.type) {
        case 'array':
        case 'Map':
        case 'Set':
          return (metadata.size ?? metadata.length ?? 0) > 0;
        case 'object':
          return (metadata.size ?? 0) > 0;
        case 'ArrayBuffer':
        case 'DataView':
          return (metadata.byteLength ?? 0) > 0;
        case 'circular':
        case 'promise':
        case 'function':
        case 'error':
          return false;
        default:
          if ('entries' in metadata || 'items' in metadata) {
            return true;
          }
          return false;
      }
    }

    return isExpandable(value);
  }, [value]);

  const { overrideProps, overrideHookState } = getOverrideMethods();
  const canEdit = useMemo(() => {
    return (
      allowEditing &&
      (section === 'props'
        ? !!overrideProps && name !== 'children'
        : section === 'state'
          ? !!overrideHookState
          : false)
    );
  }, [section, overrideProps, overrideHookState, allowEditing, name]);

  const isBadRender = useMemo(() => {
    const isFirstRender = !globalInspectorState.lastRendered.has(currentPath);

    if (isFirstRender) {
      if (typeof value === 'function') {
        return true;
      }

      if (typeof value !== 'object') {
        return false;
      }
    }

    const shouldShowChange =
      !isFirstRender ||
      !isEqual(globalInspectorState.lastRendered.get(currentPath), value);

    const isBadRender = level === 0 && shouldShowChange && !isPromise(value);

    return isBadRender;
  }, [currentPath, level, value]);

  const handleEdit = useCallback(() => {
    if (canEdit) {
      setIsEditing(true);
    }
  }, [canEdit]);

  const handleSave = useCallback((newValue: unknown) => {
    if (isEqual(value, newValue)) {
      setIsEditing(false);
      return;
    }

    if (section === 'props' && overrideProps) {
      tryOrElse(() => {
        if (!fiber) return;

        if (parentPath) {
          const parts = parentPath.split('.');
          const path = parts.filter(
            (part) => part !== 'props' && part !== getDisplayName(fiber.type),
          );
          path.push(name);
          overrideProps(fiber, path, newValue);
        } else {
          overrideProps(fiber, [name], newValue);
        }
      }, null);
    }

    if (section === 'state' && overrideHookState) {
      tryOrElse(() => {
        if (!fiber) return;

        if (!parentPath) {
          const stateNames = getStateNames(fiber);
          const namedStateIndex = stateNames.indexOf(name);
          const hookId =
            namedStateIndex !== -1 ? namedStateIndex.toString() : '0';
          overrideHookState(fiber, hookId, [], newValue);
        } else {
          const fullPathParts = parentPath.split('.');
          const stateIndex = fullPathParts.indexOf('state');
          if (stateIndex === -1) return;

          const statePath = fullPathParts.slice(stateIndex + 1);
          const baseStateKey = statePath[0];
          const stateNames = getStateNames(fiber);
          const namedStateIndex = stateNames.indexOf(baseStateKey);
          const hookId =
            namedStateIndex !== -1 ? namedStateIndex.toString() : '0';

          const currentState = inspectorState.value.fiberState.current;
          if (!currentState || !(baseStateKey in currentState)) {
            // biome-ignore lint/suspicious/noConsole: Intended debug output
            console.warn(sanitizeErrorMessage('Invalid state key'));
            return;
          }

          const updatedState = updateNestedValue(
            currentState[baseStateKey],
            statePath.slice(1).concat(name),
            newValue,
          );
          overrideHookState(fiber, hookId, [], updatedState);
        }
      }, null);
    }

    setIsEditing(false);
  }, [value, section, overrideProps, overrideHookState, fiber, name, parentPath]);

  const checkCircularInValue = useMemo((): boolean => {
    if (!value || typeof value !== 'object' || isPromise(value)) return false;

    return 'type' in value && value.type === 'circular';
  }, [value]);

  const renderNestedProperties = useCallback(
    (obj: unknown): preact.ComponentChildren => {
      if (!obj || typeof obj !== 'object') return null;

      if ('type' in obj) {
        const metadata = obj as ValueMetadata;
        if ('entries' in metadata && metadata.entries) {
          const entries = Object.entries(metadata.entries);
          if (entries.length === 0) return null;

          return (
            <div className="react-scan-nested">
              {entries.map(([key, val]) => (
                <PropertyElement
                  key={`${currentPath}-entry-${key}`}
                  name={key}
                  value={val}
                  section={section}
                  level={level + 1}
                  parentPath={currentPath}
                  objectPathMap={objectPathMap}
                  changedKeys={changedKeys}
                  allowEditing={allowEditing}
                />
              ))}
            </div>
          );
        }

        if ('items' in metadata && Array.isArray(metadata.items)) {
          if (metadata.items.length === 0) return null;
          return (
            <div className="react-scan-nested">
              {
                metadata.items.map((item, i) => {
                  const itemKey = `${currentPath}-item-${item.type}-${i}`;
                  return (
                    <PropertyElement
                      key={itemKey}
                      name={`${i}`}
                      value={item}
                      section={section}
                      level={level + 1}
                      parentPath={currentPath}
                      objectPathMap={objectPathMap}
                      changedKeys={changedKeys}
                      allowEditing={allowEditing}
                    />
                  );
                })
              }
            </div>
          );
        }
        return null;
      }

      let entries: Array<[key: string | number, value: unknown]>;

      if (obj instanceof ArrayBuffer) {
        const view = new Uint8Array(obj);
        entries = Array.from(view).map((v, i) => [i, v]);
      } else if (obj instanceof DataView) {
        const view = new Uint8Array(obj.buffer, obj.byteOffset, obj.byteLength);
        entries = Array.from(view).map((v, i) => [i, v]);
      } else if (ArrayBuffer.isView(obj)) {
        if (obj instanceof BigInt64Array || obj instanceof BigUint64Array) {
          entries = Array.from({ length: obj.length }, (_, i) => [
            i,
            obj[i],
          ]);
        } else {
          const typedArray = obj as unknown as ArrayLike<number>;
          entries = Array.from(typedArray).map((v, i) => [i, v]);
        }
      } else if (obj instanceof Map) {
        entries = Array.from(obj.entries()).map(([k, v]) => [String(k), v]);
      } else if (obj instanceof Set) {
        entries = Array.from(obj).map((v, i) => [i, v]);
      } else if (Array.isArray(obj)) {
        entries = obj.map((value, index) => [`${index}`, value]);
      } else {
        entries = Object.entries(obj);
      }

      if (entries.length === 0) return null;

      const canEditChildren = !(
        obj instanceof DataView ||
        obj instanceof ArrayBuffer ||
        ArrayBuffer.isView(obj)
      );

      return (
        <div className="react-scan-nested">
          {
            entries.map(([key, val]) => {
              const itemKey = `${currentPath}-${typeof key === 'number' ? `item-${key}` : key}`;
              return (
                <PropertyElement
                  key={itemKey}
                  name={String(key)}
                  value={val}
                  section={section}
                  level={level + 1}
                  parentPath={currentPath}
                  objectPathMap={objectPathMap}
                  changedKeys={changedKeys}
                  allowEditing={canEditChildren}
                />
              );
            })
          }
        </div>
      );
    },
    [section, level, currentPath, objectPathMap, changedKeys, allowEditing],
  );

  const renderMemoizationIcon = useMemo(() => {
    if (changedKeys.has(`${name}:memoized`)) {
      return <Icon name="icon-shield" className="text-green-600" size={14} />;
    }
    if (changedKeys.has(`${name}:unmemoized`)) {
      return <Icon name="icon-flame" className="text-red-500" size={14} />;
    }
    return null;
  }, [changedKeys, name]);

  if (checkCircularInValue) {
    return (
      <div className="react-scan-property">
        <div className="react-scan-property-content">
          <div className="react-scan-preview-line">
            <div className="react-scan-key">{name}:</div>
            <span className="text-yellow-500">[Circular Reference]</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={refElement} className="react-scan-property">
      <div className="react-scan-property-content">
        {
          isExpandableValue && (
            <button
              type="button"
              onClick={handleToggleExpand}
              className="react-scan-arrow"
            >
              <Icon
                name="icon-chevron-right"
                size={12}
                className={cn({
                  'rotate-90': isExpanded,
                })}
              />
            </button>
          )
        }

        <div
          className={cn(
            'group',
            'react-scan-preview-line',
            {
              'react-scan-highlight': isChanged,
            },
          )}
        >
          {
            isBadRender &&
            !changedKeys.has(`${name}:memoized`) &&
            !changedKeys.has(`${name}:unmemoized`) && (
              <Icon
                name="icon-bell-ring"
                className="text-yellow-500"
                size={14}
              />
            )
          }
          {renderMemoizationIcon}
          <div className="react-scan-key">{name}:</div>
          {
            isEditing && isEditableValue(value, parentPath)
              ? (
                <EditableValue
                  value={value}
                  onSave={handleSave}
                  onCancel={() => setIsEditing(false)}
                />
              )
              : (
                <button type="button" className="truncate" onClick={handleEdit}>
                  {valuePreview}
                </button>
              )
          }
          <CopyToClipboard
            text={clipboardText}
            className="opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          >
            {({ ClipboardIcon }) => <>{ClipboardIcon}</>}
          </CopyToClipboard>
        </div>
        <div
          className={cn(
            'react-scan-expandable',
            {
              'react-scan-expanded': isExpanded,
            },
          )}
        >
          {
            isExpandableValue && (
              <div className="react-scan-nested">
                {renderNestedProperties(value)}
              </div>
            )
          }
        </div>
      </div>
    </div>
  );
};

const PropertySection = ({ title, section }: PropertySectionProps) => {
  const { fiberProps, fiberState, fiberContext } = inspectorState.value;

  const pathMap = useMemo(() => new WeakMap<object, Set<string>>(), []);
  const { currentData, changedKeys } = useMemo(() => {
    switch (section) {
      case 'props':
        return {
          currentData: fiberProps.current,
          changedKeys: fiberProps.changes,
        };
      case 'state':
        return {
          currentData: fiberState.current,
          changedKeys: fiberState.changes,
        };
      case 'context':
        return {
          currentData: fiberContext.current,
          changedKeys: fiberContext.changes,
        };
      default:
        return {
          currentData: {},
          changedKeys: new Set<string>(),
        };
    }
  }, [section, fiberState, fiberProps, fiberContext]);

  if (!currentData || Object.keys(currentData).length === 0) {
    return null;
  }

  return (
    <div className="react-scan-section">
      <div>{title}</div>
      {
        Object.entries(currentData).map(([key, value]) => (
          <PropertyElement
            key={key}
            name={key}
            value={value}
            section={section}
            level={0}
            objectPathMap={pathMap}
            changedKeys={changedKeys}
          />
        ))
      }
    </div>
  );
};

const WhatChanged = constant(() => {
  const refPrevFiber = useRef<Fiber | null>(null);
  const [isExpanded, setIsExpanded] = useState(Store.wasDetailsOpen.value);
  const [shouldShow, setShouldShow] = useState(false);

  const {
    fiber,
    fiberProps,
    fiberState,
    fiberContext,
  } = inspectorState.value;

  const renderSection = useCallback((
    sectionName: 'state' | 'props' | 'context',
    items: Set<string>,
    getCount: (key: string) => number,
  ) => {
    const elements = Array.from(items).reduce<JSX.Element[]>((acc, key) => {
      if (sectionName === 'props') {
        const isUnmemoized = key.endsWith(':unmemoized');
        if (isUnmemoized) {
          acc.push(
            <li key={key}>
              <div>
                {key.split(':')[0]}{' '}
                <Icon
                  name="icon-flame"
                  className="text-white shadow-sm mr-2"
                  size={14}
                />
              </div>
            </li>,
          );
        }
      }

      const count = getCount(key);
      if (count > 0) {
        const displayKey =
          sectionName === 'context' ? key.replace(/^context\./, '') : key;
        acc.push(
          <li key={key}>
            {displayKey} ×{count}
          </li>,
        );
      }

      return acc;
    }, []);

    if (!elements.length) return null;

    return (
      <>
        <div>{sectionName.charAt(0).toUpperCase() + sectionName.slice(1)}:</div>
        <ul>{elements}</ul>
      </>
    );
  }, []);

  const stateSection = useMemo(
    () => renderSection('state', fiberState.changes, getStateChangeCount),
    [fiberState.changes, renderSection],
  );

  const propsSection = useMemo(
    () => renderSection('props', fiberProps.changes, getPropsChangeCount),
    [fiberProps.changes, renderSection],
  );

  const contextSection = useMemo(
    () => renderSection('context', fiberContext.changes, getContextChangeCount),
    [fiberContext.changes, renderSection],
  );

  const { hasChanges, sections } = useMemo(() => {
    return {
      hasChanges: !!(stateSection || propsSection || contextSection),
      sections: [stateSection, propsSection, contextSection],
    };
  }, [stateSection, propsSection, contextSection]);

  useEffect(() => {
    if (!refPrevFiber.current || refPrevFiber.current.type !== fiber?.type) {
      refPrevFiber.current = fiber;
      setShouldShow(false);
      return;
    }

    refPrevFiber.current = fiber;
    setShouldShow(hasChanges);
  }, [hasChanges, fiber]);

  const handleToggle = useCallback(() => {
    setIsExpanded((state) => {
      Store.wasDetailsOpen.value = !state;
      return !state;
    });
  }, []);

  return (
    <div
      className={cn(
        'react-scan-expandable',
        {
          'react-scan-expanded': shouldShow,
        },
      )}
    >
      {shouldShow && refPrevFiber.current?.type === fiber?.type && (
        <div
          onClick={handleToggle}
          onKeyDown={(e) => e.key === 'Enter' && handleToggle()}
          className={cn(
            'flex flex-col',
            'px-1 py-2',
            'text-left text-white',
            'bg-yellow-600',
            'overflow-hidden',
            'opacity-0',
            'transition-all duration-300 delay-300',
            {
              'opacity-100 delay-0': shouldShow,
            },
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <span className="flex w-8 items-center justify-center">
                <Icon
                  name="icon-chevron-right"
                  size={12}
                  className={cn({
                    'rotate-90': isExpanded,
                  })}
                />
              </span>
              What changed?
            </div>
          </div>
          <div
            className={cn(
              'react-scan-what-changed',
              'react-scan-expandable pl-8 flex-1',
              {
                'react-scan-expanded pt-2': isExpanded,
              },
            )}
          >
            <div className="overflow-hidden">{sections}</div>
          </div>
        </div>
      )}
    </div>
  );
});

export const Inspector = constant(() => {
  const refLastInspectedFiber = useRef<Fiber | null>(null);

  const isSettingsOpen = signalIsSettingsOpen.value;

  useEffect(() => {
    let isProcessing = false;
    const pendingUpdates = new Set<Fiber>();

    const processNextUpdate = () => {
      if (pendingUpdates.size === 0) {
        isProcessing = false;
        return;
      }

      const nextFiber = Array.from(pendingUpdates)[0];
      pendingUpdates.delete(nextFiber);

      try {
        refLastInspectedFiber.current = nextFiber;

        inspectorState.value = {
          fiber: nextFiber,
          ...collectInspectorData(nextFiber),
        };
      } finally {
        if (pendingUpdates.size > 0) {
          queueMicrotask(processNextUpdate);
        } else {
          isProcessing = false;
        }
      }
    };

    const unSubState = Store.inspectState.subscribe((state) => {
      if (state.kind !== 'focused' || !state.focusedDomElement) {
        pendingUpdates.clear();
        return;
      }

      if (state.kind === 'focused') {
        signalIsSettingsOpen.value = false;
      }

      const { parentCompositeFiber } = getCompositeFiberFromElement(
        state.focusedDomElement,
      );
      if (!parentCompositeFiber) return;

      pendingUpdates.clear();
      globalInspectorState.cleanup();
      refLastInspectedFiber.current = parentCompositeFiber;

      const {
        fiberProps,
        fiberState,
        fiberContext,
      } = collectInspectorData(parentCompositeFiber);

      inspectorState.value = {
        fiber: parentCompositeFiber,
        fiberProps: {
          ...fiberProps,
          changes: new Set(),
        },
        fiberState: {
          ...fiberState,
          changes: new Set(),
        },
        fiberContext: {
          ...fiberContext,
          changes: new Set(),
        },
      };
    });

    const unSubReport = Store.lastReportTime.subscribe(() => {
      const inspectState = Store.inspectState.value;
      if (inspectState.kind !== 'focused') {
        pendingUpdates.clear();
        return;
      }

      const element = inspectState.focusedDomElement;
      const { parentCompositeFiber } = getCompositeFiberFromElement(element);

      if (!parentCompositeFiber) {
        Store.inspectState.value = {
          kind: 'inspect-off',
        };
        return;
      }

      if (parentCompositeFiber.type === refLastInspectedFiber.current?.type) {
        pendingUpdates.add(parentCompositeFiber);

        if (!isProcessing) {
          isProcessing = true;
          queueMicrotask(processNextUpdate);
        }
      }
    });

    return () => {
      unSubState();
      unSubReport();
      pendingUpdates.clear();
      globalInspectorState.cleanup();
      resetStateTracking();
    };
  }, []);

  return (
    <InspectorErrorBoundary>
      <div
        className={cn(
          'react-scan-inspector',
          'opacity-0',
          'max-h-0',
          'overflow-hidden',
          'transition-opacity duration-150 delay-0',
          'pointer-events-none',
          {
            'opacity-100 delay-300 pointer-events-auto max-h-["auto"]': !isSettingsOpen,
          },
        )}
      >
        <WhatChanged />
        <PropertySection title="Props" section="props" />
        <PropertySection title="State" section="state" />
        <PropertySection title="Context" section="context" />
      </div>
    </InspectorErrorBoundary>
  );
});

export const replayComponent = async (fiber: Fiber): Promise<void> => {
  const { overrideProps, overrideHookState } = getOverrideMethods();
  if (!overrideProps || !overrideHookState || !fiber) return;

  const currentProps = fiber.memoizedProps || {};
  for (const key of Object.keys(currentProps)) {
    try {
      overrideProps(fiber, [key], currentProps[key]);
    } catch {}
  }

  const currentState = getCurrentFiberState(fiber);
  if (currentState) {
    const stateNames = getStateNames(fiber);
    for (const [key, value] of Object.entries(currentState)) {
      try {
        const namedStateIndex = stateNames.indexOf(key);
        const hookId = namedStateIndex !== -1 ? namedStateIndex.toString() : '0';
        overrideHookState(fiber, hookId, [], value);
      } catch {}
    }
  }

  let child = fiber.child;
  while (child) {
    await replayComponent(child);
    child = child.sibling;
  }
};
