import {
  clampPage,
  clampPageSize,
  resolveDir,
  resolveSort,
} from './data-grid';

describe('data-grid helpers', () => {
  it('clampPageSize borne et applique un défaut', () => {
    expect(clampPageSize(undefined)).toBe(20);
    expect(clampPageSize('0')).toBe(20);
    expect(clampPageSize('5')).toBe(5);
    expect(clampPageSize(9999, 100)).toBe(100);
  });

  it('clampPage minimum 1', () => {
    expect(clampPage(undefined)).toBe(1);
    expect(clampPage('0')).toBe(1);
    expect(clampPage('3')).toBe(3);
  });

  it('resolveSort n’accepte que les colonnes autorisées', () => {
    const sortable = ['code', 'name'];
    expect(resolveSort('name', sortable, 'code')).toBe('name');
    expect(resolveSort('evil; DROP TABLE', sortable, 'code')).toBe('code');
    expect(resolveSort(undefined, sortable, 'code')).toBe('code');
  });

  it('resolveDir normalise', () => {
    expect(resolveDir('desc')).toBe('DESC');
    expect(resolveDir('ASC')).toBe('ASC');
    expect(resolveDir(undefined)).toBe('ASC');
  });
});
