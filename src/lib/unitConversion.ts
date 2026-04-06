import { Unit } from '../types';

export const getUnitById = (units: Unit[], id?: string) =>
  units.find((u) => u.id === id);

export const getUnitByName = (units: Unit[], name?: string) =>
  units.find((u) => u.name === name);

export const getBaseUnitId = (units: Unit[], unitId?: string) => {
  const unit = getUnitById(units, unitId);
  if (!unit) return unitId || '';
  if (unit.isBase || !unit.baseUnitId) return unit.id;
  return unit.baseUnitId;
};

export const getUnitFactor = (units: Unit[], unitId?: string) => {
  const unit = getUnitById(units, unitId);
  if (!unit) return 1;
  if (unit.isBase || !unit.baseUnitId) return 1;
  return Number(unit.factor || 1);
};

export const toBaseQuantity = (qty: number, units: Unit[], unitId?: string) =>
  Number(qty || 0) * getUnitFactor(units, unitId);

export const formatUnitRule = (unit: Unit, units: Unit[]) => {
  if (unit.isBase || !unit.baseUnitId) return `1 ${unit.name} = 1 ${unit.name}`;
  const base = getUnitById(units, unit.baseUnitId);
  return `1 ${unit.name} = ${Number(unit.factor || 1)} ${base?.name || ''}`.trim();
};
