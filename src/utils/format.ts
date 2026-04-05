import chalk from 'chalk';

export interface OutputOptions {
  json?: boolean;
}

export function output(data: unknown, opts: OutputOptions): void {
  if (opts.json) {
    console.log(JSON.stringify(data, replacer, 2));
  } else if (Array.isArray(data)) {
    printTable(data);
  } else {
    printObject(data as Record<string, unknown>);
  }
}

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function printTable(rows: Record<string, unknown>[]): void {
  if (rows.length === 0) {
    console.log(chalk.dim('(no data)'));
    return;
  }
  const keys = Object.keys(rows[0]!);
  const widths = keys.map((k) =>
    Math.max(k.length, ...rows.map((r) => String(r[k] ?? '').length)),
  );

  const header = keys.map((k, i) => chalk.bold(k.padEnd(widths[i]!))).join('  ');
  console.log(header);
  console.log(chalk.dim('-'.repeat(header.length)));
  for (const row of rows) {
    console.log(keys.map((k, i) => String(row[k] ?? '').padEnd(widths[i]!)).join('  '));
  }
}

function printObject(obj: Record<string, unknown>): void {
  const maxKey = Math.max(...Object.keys(obj).map((k) => k.length));
  for (const [key, value] of Object.entries(obj)) {
    console.log(`${chalk.bold(key.padEnd(maxKey))}  ${value}`);
  }
}

export function formatUsd(value: bigint, decimals = 30): string {
  const str = value.toString().padStart(decimals + 1, '0');
  const intPart = str.slice(0, str.length - decimals) || '0';
  const decPart = str.slice(str.length - decimals, str.length - decimals + 2);
  return `$${Number(intPart).toLocaleString()}.${decPart}`;
}

export function formatToken(value: bigint, decimals = 18): string {
  const str = value.toString().padStart(decimals + 1, '0');
  const intPart = str.slice(0, str.length - decimals) || '0';
  const decPart = str.slice(str.length - decimals, str.length - decimals + 4);
  return `${Number(intPart).toLocaleString()}.${decPart}`;
}
