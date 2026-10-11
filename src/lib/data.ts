import type { Dataset, Events, Heartbeats, Meta, Site, Device } from '../types';

const BASE = import.meta.env.BASE_URL ?? '/';

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}data/${path}`);
  if (!res.ok) {
    throw new Error(`加载 ${path} 失败：HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function loadDataset(): Promise<Dataset> {
  const [sites, devices, events, heartbeats, meta] = await Promise.all([
    fetchJson<Site[]>('mock_sites.json'),
    fetchJson<Device[]>('mock_devices.json'),
    fetchJson<Events>('mock_events.json'),
    fetchJson<Heartbeats>('mock_heartbeats.json'),
    fetchJson<Meta>('mock_meta.json'),
  ]);
  return { sites, devices, events, heartbeats, meta };
}

export interface Dicts {
  styles: Map<string, string>;
  failureReasons: Map<string, string>;
  rejectReasons: Map<string, string>;
}

const toMap = (items: { id: string; name: string }[]): Map<string, string> =>
  new Map(items.map((i) => [i.id, i.name]));

export function buildDicts(meta: Meta): Dicts {
  return {
    styles: toMap(meta.dictionaries.styles),
    failureReasons: toMap(meta.dictionaries.failureReasons),
    rejectReasons: toMap(meta.dictionaries.rejectReasons),
  };
}

export function dictLabel(dict: Map<string, string>, key: string): string {
  return dict.get(key) ?? key;
}
