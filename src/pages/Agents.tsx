import React, { useEffect, useMemo, useState } from 'react';
import { CircleMarker, MapContainer, Popup, TileLayer, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { Activity, ClipboardList, Filter, MapPin, Plus, RefreshCw, RotateCcw, Send, Truck, UserPlus } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { getSelectedBranchId, getStoredUser } from '../lib/companySession';
import { AdaptiveModal } from '../components/responsive';
import { Agent, AgentInventoryLine, AgentTransfer, InventoryItem, Warehouse, Invoice, DEFAULT_ROLE_PERMISSIONS, PartyType } from '../types';

import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow
});

interface AgentsProps {
  agents: Agent[];
  setAgents: React.Dispatch<React.SetStateAction<Agent[]>>;
  inventory: InventoryItem[];
  warehouses: Warehouse[];
  invoices: Invoice[];
  refreshData: () => Promise<void>;
}

const MapInteractionHandler: React.FC<{
  onPick: (lat: number, lng: number) => void;
  onContext: (lat: number, lng: number, x: number, y: number) => void;
  onClearContext: () => void;
}> = ({ onPick, onContext, onClearContext }) => {
  useMapEvents({
    click: (e) => {
      onClearContext();
      onPick(e.latlng.lat, e.latlng.lng);
    },
    contextmenu: (e) => {
      onContext(e.latlng.lat, e.latlng.lng, e.originalEvent.clientX, e.originalEvent.clientY);
    }
  });
  return null;
};

const agentColors = ['#0ea5e9', '#10b981', '#f97316', '#8b5cf6', '#ef4444', '#14b8a6'];
const AGENT_FORM_COPY = {
  title: '\u0625\u0636\u0627\u0641\u0629 \u0645\u0646\u062f\u0648\u0628 \u0645\u064a\u062f\u0627\u0646\u064a',
  subtitle: '\u0623\u0646\u0634\u0626 \u062d\u0633\u0627\u0628\u064b\u0627 \u062a\u0634\u063a\u064a\u0644\u064a\u064b\u0627 \u0645\u0631\u0628\u0648\u0637\u064b\u0627 \u0628\u0641\u0631\u0639 \u0645\u062d\u062f\u062f \u0645\u0639 \u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u0647\u0648\u064a\u0629 \u0648\u0627\u0644\u0639\u0645\u0648\u0644\u0629 \u062d\u062a\u0649 \u064a\u062f\u062e\u0644 \u0645\u0628\u0627\u0634\u0631\u0629 \u0641\u064a \u062f\u0648\u0631\u0629 \u0627\u0644\u0645\u0628\u064a\u0639\u0627\u062a \u0648\u0627\u0644\u0645\u062e\u0632\u0648\u0646.',
  branchBadge: '\u0627\u0644\u0641\u0631\u0639 \u0627\u0644\u062d\u0627\u0644\u064a',
  branchFallback: '\u063a\u064a\u0631 \u0645\u062d\u062f\u062f',
  identity: '\u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u0645\u0646\u062f\u0648\u0628',
  name: '\u0627\u0633\u0645 \u0627\u0644\u0645\u0646\u062f\u0648\u0628',
  phone: '\u0631\u0642\u0645 \u0627\u0644\u0647\u0627\u062a\u0641',
  branch: '\u0627\u062e\u062a\u0631 \u0627\u0644\u0641\u0631\u0639 \u0627\u0644\u062a\u0634\u063a\u064a\u0644\u064a',
  vehicle: '\u0627\u0644\u0645\u0631\u0643\u0628\u0629 \u0623\u0648 \u0648\u0633\u064a\u0644\u0629 \u0627\u0644\u0646\u0642\u0644',
  username: '\u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645',
  password: '\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631',
  commissionAndFiles: '\u0627\u0644\u0639\u0645\u0648\u0644\u0629 \u0648\u0627\u0644\u0645\u0644\u0641\u0627\u062a',
  commission: '\u0646\u0633\u0628\u0629 \u0627\u0644\u0639\u0645\u0648\u0644\u0629 %',
  vehicleImage: '\u0635\u0648\u0631\u0629 \u0627\u0644\u0645\u0631\u0643\u0628\u0629',
  permitImage: '\u0635\u0648\u0631\u0629 \u0627\u0644\u0634\u0647\u0627\u062f\u0629 \u0623\u0648 \u0627\u0644\u062a\u0631\u062e\u064a\u0635',
  notes: '\u0645\u0644\u0627\u062d\u0638\u0627\u062a \u062a\u0634\u063a\u064a\u0644\u064a\u0629',
  readiness: '\u062c\u0627\u0647\u0632\u064a\u0629 \u0627\u0644\u062a\u0634\u063a\u064a\u0644',
  readinessBody: '\u0633\u064a\u064f\u0646\u0634\u0623 \u0644\u0644\u0645\u0646\u062f\u0648\u0628 \u062d\u0633\u0627\u0628 \u0645\u0633\u062a\u062e\u062f\u0645 \u0648\u0631\u0628\u0637 \u0645\u0628\u0627\u0634\u0631 \u0628\u0641\u0631\u0639\u0647 \u0627\u0644\u062a\u0634\u063a\u064a\u0644\u064a \u0645\u0639 \u0627\u0644\u0635\u0644\u0627\u062d\u064a\u0627\u062a \u0627\u0644\u0623\u0633\u0627\u0633\u064a\u0629 \u0644\u0644\u0628\u064a\u0639 \u0627\u0644\u0645\u064a\u062f\u0627\u0646\u064a.',
  permissions: '\u0635\u0644\u0627\u062d\u064a\u0627\u062a \u0623\u0633\u0627\u0633\u064a\u0629',
  cancel: '\u0625\u0644\u063a\u0627\u0621',
  submit: '\u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u0645\u0646\u062f\u0648\u0628',
  submitting: '\u062c\u0627\u0631\u064d \u0627\u0644\u0625\u0646\u0634\u0627\u0621...',
};
const modalPanelClassName = 'max-h-[92vh] overflow-visible bg-transparent shadow-none';
const modalShellClassName = 'w-full overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_30px_100px_rgba(15,23,42,0.2)]';
const modalFieldClassName = 'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100';
const modalMutedFieldClassName = 'w-full rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-xs font-bold text-slate-500';
const modalGhostButtonClassName = 'rounded-2xl border border-slate-200 px-5 py-3 text-sm font-black text-slate-500 transition hover:border-slate-300 hover:text-slate-700';
const modalListPanelClassName = 'rounded-[1.6rem] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-5';
const TRANSFER_MODAL_COPY = {
  badge: '\u062a\u0631\u062d\u064a\u0644 \u0645\u0646 \u0627\u0644\u0645\u0633\u062a\u0648\u062f\u0639',
  title: '\u062a\u0631\u062d\u064a\u0644 \u0645\u0648\u0627\u062f \u0625\u0644\u0649 \u0627\u0644\u0645\u0646\u062f\u0648\u0628',
  subtitle: '\u0627\u0646\u0642\u0644 \u0627\u0644\u0645\u0648\u0627\u062f \u0645\u0646 \u0627\u0644\u0645\u0633\u062a\u0648\u062f\u0639 \u0625\u0644\u0649 \u0645\u062e\u0632\u0648\u0646 \u0627\u0644\u0645\u0646\u062f\u0648\u0628 \u0636\u0645\u0646 \u062f\u0648\u0631\u0629 \u062a\u0634\u063a\u064a\u0644 \u0648\u0627\u0636\u062d\u0629 \u0648\u0645\u062e\u062a\u0635\u0631\u0629.',
  count: '\u0623\u0633\u0637\u0631 \u0627\u0644\u062a\u0631\u062d\u064a\u0644',
  countHint: '\u062c\u0627\u0647\u0632\u0629 \u0644\u0644\u0625\u0631\u0633\u0627\u0644',
  section: '\u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u0639\u0645\u0644\u064a\u0629',
  selectAgent: '\u0627\u062e\u062a\u0631 \u0627\u0644\u0645\u0646\u062f\u0648\u0628',
  selectWarehouse: '\u0627\u062e\u062a\u0631 \u0627\u0644\u0645\u0633\u062a\u0648\u062f\u0639',
  searchItem: '\u0627\u0628\u062d\u062b \u0639\u0646 \u0635\u0646\u0641',
  selectItem: '\u0627\u062e\u062a\u0631 \u0627\u0644\u0635\u0646\u0641',
  quantity: '\u0627\u0644\u0643\u0645\u064a\u0629',
  addLine: '\u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0633\u0637\u0631 \u0625\u0644\u0649 \u0627\u0644\u0642\u0627\u0626\u0645\u0629',
  notes: '\u0645\u0644\u0627\u062d\u0638\u0627\u062a \u0627\u0644\u0639\u0645\u0644\u064a\u0629',
  summary: '\u0645\u0644\u062e\u0635 \u0627\u0644\u0637\u0644\u0628',
  summaryBody: '\u0631\u0627\u062c\u0639 \u0627\u0644\u0623\u0635\u0646\u0627\u0641 \u0648\u0627\u0644\u0643\u0645\u064a\u0627\u062a \u0642\u0628\u0644 \u0627\u0639\u062a\u0645\u0627\u062f \u0627\u0644\u062a\u0631\u062d\u064a\u0644.',
  totalQty: '\u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u0643\u0645\u064a\u0629',
  empty: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0623\u0633\u0637\u0631 \u0645\u0636\u0627\u0641\u0629 \u0628\u0639\u062f.',
  line: '\u0633\u0637\u0631 \u0631\u0642\u0645',
  safety: '\u062a\u0646\u0628\u064a\u0647 \u062a\u0634\u063a\u064a\u0644\u064a',
  safetyBody: '\u0644\u0646 \u064a\u062a\u0645 \u0627\u0644\u062a\u0631\u062d\u064a\u0644 \u0625\u0644\u0627 \u0628\u0639\u062f \u0627\u0644\u062a\u062d\u0642\u0642 \u0645\u0646 \u062a\u0648\u0641\u0631 \u0627\u0644\u0645\u062e\u0632\u0648\u0646 \u0641\u064a \u0627\u0644\u0645\u0633\u062a\u0648\u062f\u0639 \u0627\u0644\u0645\u062d\u062f\u062f.',
  close: '\u0625\u063a\u0644\u0627\u0642',
  submit: '\u062a\u0646\u0641\u064a\u0630 \u0627\u0644\u062a\u0631\u062d\u064a\u0644',
  submitting: '\u062c\u0627\u0631\u064d \u062a\u0646\u0641\u064a\u0630 \u0627\u0644\u062a\u0631\u062d\u064a\u0644...',
  available: '\u0627\u0644\u0645\u062a\u0627\u062d',
};
const RETURN_MODAL_COPY = {
  badge: '\u0645\u0631\u062a\u062c\u0639 \u0625\u0644\u0649 \u0627\u0644\u0645\u0633\u062a\u0648\u062f\u0639',
  title: '\u0645\u0631\u062a\u062c\u0639 \u0645\u0646 \u0627\u0644\u0645\u0646\u062f\u0648\u0628',
  subtitle: '\u0623\u0639\u062f \u0627\u0644\u0645\u0648\u0627\u062f \u0645\u0646 \u0645\u062e\u0632\u0648\u0646 \u0627\u0644\u0645\u0646\u062f\u0648\u0628 \u0625\u0644\u0649 \u0627\u0644\u0645\u0633\u062a\u0648\u062f\u0639 \u0645\u0639 \u062a\u062a\u0628\u0639 \u0648\u0627\u0636\u062d \u0644\u0644\u0643\u0645\u064a\u0627\u062a \u0627\u0644\u0645\u0639\u0627\u062f\u0629.',
  count: '\u0623\u0633\u0637\u0631 \u0627\u0644\u0645\u0631\u062a\u062c\u0639',
  countHint: '\u062c\u0627\u0647\u0632\u0629 \u0644\u0644\u0625\u0639\u0627\u062f\u0629',
  section: '\u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u0645\u0631\u062a\u062c\u0639',
  selectAgent: '\u0627\u062e\u062a\u0631 \u0627\u0644\u0645\u0646\u062f\u0648\u0628',
  selectWarehouse: '\u0627\u062e\u062a\u0631 \u0627\u0644\u0645\u0633\u062a\u0648\u062f\u0639',
  selectItem: '\u0627\u062e\u062a\u0631 \u0627\u0644\u0635\u0646\u0641',
  quantity: '\u0627\u0644\u0643\u0645\u064a\u0629',
  addLine: '\u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0633\u0637\u0631 \u0625\u0644\u0649 \u0627\u0644\u0642\u0627\u0626\u0645\u0629',
  notes: '\u0645\u0644\u0627\u062d\u0638\u0627\u062a \u0627\u0644\u0645\u0631\u062a\u062c\u0639',
  summary: '\u0645\u0644\u062e\u0635 \u0627\u0644\u0645\u0631\u062a\u062c\u0639',
  summaryBody: '\u0631\u0627\u062c\u0639 \u0627\u0644\u0623\u0635\u0646\u0627\u0641 \u0648\u0627\u0644\u0643\u0645\u064a\u0627\u062a \u0642\u0628\u0644 \u0627\u0639\u062a\u0645\u0627\u062f \u0627\u0644\u0645\u0631\u062a\u062c\u0639.',
  totalQty: '\u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u0643\u0645\u064a\u0629',
  empty: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0623\u0633\u0637\u0631 \u0645\u0636\u0627\u0641\u0629 \u0628\u0639\u062f.',
  line: '\u0633\u0637\u0631 \u0631\u0642\u0645',
  safety: '\u062a\u0646\u0628\u064a\u0647 \u062a\u0634\u063a\u064a\u0644\u064a',
  safetyBody: '\u0633\u064a\u062a\u0645 \u0627\u0644\u062a\u062d\u0642\u0642 \u0645\u0646 \u0631\u0635\u064a\u062f \u0627\u0644\u0645\u0646\u062f\u0648\u0628 \u0642\u0628\u0644 \u0625\u0639\u0627\u062f\u0629 \u0627\u0644\u0645\u0648\u0627\u062f \u0625\u0644\u0649 \u0627\u0644\u0645\u0633\u062a\u0648\u062f\u0639.',
  close: '\u0625\u063a\u0644\u0627\u0642',
  submit: '\u062a\u0646\u0641\u064a\u0630 \u0627\u0644\u0645\u0631\u062a\u062c\u0639',
  submitting: '\u062c\u0627\u0631\u064d \u062a\u0646\u0641\u064a\u0630 \u0627\u0644\u0645\u0631\u062a\u062c\u0639...',
  available: '\u0627\u0644\u0645\u062a\u0627\u062d',
};
const RECONCILE_MODAL_COPY = {
  badge: '\u062a\u0633\u0648\u064a\u0629 \u0645\u062e\u0632\u0648\u0646',
  title: '\u062a\u0633\u0648\u064a\u0629 \u0645\u062e\u0632\u0648\u0646 \u0627\u0644\u0645\u0646\u062f\u0648\u0628',
  subtitle: '\u0633\u062c\u0651\u0644 \u0627\u0644\u0641\u0631\u0648\u0642\u0627\u062a \u0628\u0637\u0631\u064a\u0642\u0629 \u0645\u0636\u0628\u0648\u0637\u0629 \u0645\u0639 \u062d\u0641\u0638 \u0627\u0644\u0633\u0628\u0628 \u0648\u0627\u0644\u0643\u0645\u064a\u0629 \u0644\u0643\u0644 \u0635\u0646\u0641.',
  count: '\u0623\u0633\u0637\u0631 \u0627\u0644\u062a\u0633\u0648\u064a\u0629',
  countHint: '\u062c\u0627\u0647\u0632\u0629 \u0644\u0644\u062a\u0637\u0628\u064a\u0642',
  section: '\u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u062a\u0633\u0648\u064a\u0629',
  selectAgent: '\u0627\u062e\u062a\u0631 \u0627\u0644\u0645\u0646\u062f\u0648\u0628',
  modeAdjust: '\u062a\u0639\u062f\u064a\u0644 \u0635\u0627\u0641\u064a (+/-)',
  modeSet: '\u062a\u062b\u0628\u064a\u062a \u0627\u0644\u0631\u0635\u064a\u062f \u0627\u0644\u0646\u0647\u0627\u0626\u064a',
  selectItem: '\u0627\u062e\u062a\u0631 \u0627\u0644\u0635\u0646\u0641',
  setQty: '\u0627\u0644\u0631\u0635\u064a\u062f \u0627\u0644\u0646\u0647\u0627\u0626\u064a \u0627\u0644\u0645\u0637\u0644\u0648\u0628',
  adjustQty: '\u0642\u064a\u0645\u0629 \u0627\u0644\u062a\u0639\u062f\u064a\u0644',
  addLine: '\u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0633\u0637\u0631 \u0625\u0644\u0649 \u0627\u0644\u0642\u0627\u0626\u0645\u0629',
  notes: '\u0633\u0628\u0628 \u0627\u0644\u062a\u0633\u0648\u064a\u0629',
  summary: '\u0645\u0644\u062e\u0635 \u0627\u0644\u062a\u0633\u0648\u064a\u0629',
  summaryBody: '\u062a\u0623\u0643\u062f \u0645\u0646 \u0643\u0644 \u0633\u0637\u0631 \u0642\u0628\u0644 \u0627\u0639\u062a\u0645\u0627\u062f \u0627\u0644\u062a\u0633\u0648\u064a\u0629.',
  totalLines: '\u0639\u062f\u062f \u0627\u0644\u0623\u0633\u0637\u0631',
  empty: '\u0644\u0627 \u062a\u0648\u062c\u062f \u0623\u0633\u0637\u0631 \u0645\u0636\u0627\u0641\u0629 \u0628\u0639\u062f.',
  line: '\u0633\u0637\u0631 \u0631\u0642\u0645',
  safety: '\u0636\u0627\u0628\u0637 \u0627\u0644\u062d\u0633\u0627\u0628',
  safetyBody: '\u0644\u0646 \u062a\u064f\u0637\u0628\u0642 \u0627\u0644\u062a\u0633\u0648\u064a\u0629 \u0625\u0644\u0627 \u0645\u0639 \u0633\u0628\u0628 \u0648\u0627\u0636\u062d \u0648\u0623\u062b\u0631 \u0645\u0639\u0644\u0646 \u0639\u0644\u0649 \u0627\u0644\u0631\u0635\u064a\u062f.',
  close: '\u0625\u063a\u0644\u0627\u0642',
  submit: '\u062a\u0646\u0641\u064a\u0630 \u0627\u0644\u062a\u0633\u0648\u064a\u0629',
  submitting: '\u062c\u0627\u0631\u064d \u062a\u0646\u0641\u064a\u0630 \u0627\u0644\u062a\u0633\u0648\u064a\u0629...',
  available: '\u0627\u0644\u0645\u062a\u0627\u062d',
};
const getAgentColor = (agents: Agent[], agentId?: string) => {
  if (!agentId) return agentColors[0];
  const idx = Math.max(0, agents.findIndex(a => a.id === agentId));
  return agentColors[idx % agentColors.length];
};

const normalizeInvoiceItems = (items: any): Array<{ quantity?: number }> => {
  if (!items) return [];
  if (Array.isArray(items)) return items;
  if (typeof items === 'string') {
    try {
      const parsed = JSON.parse(items);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const Agents: React.FC<AgentsProps> = ({ agents, setAgents, inventory, warehouses, invoices, refreshData }) => {
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [activeSection, setActiveSection] = useState<'agents' | 'map'>('agents');
  const [agentInventory, setAgentInventory] = useState<AgentInventoryLine[]>([]);
  const [agentInventoryTotals, setAgentInventoryTotals] = useState<Record<string, number>>({});
  const [agentTransfers, setAgentTransfers] = useState<AgentTransfer[]>([]);
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [branchFilter, setBranchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [onlineFilter, setOnlineFilter] = useState<'all' | 'online' | 'offline'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [transferTypeFilter, setTransferTypeFilter] = useState<'all' | 'transfer' | 'return' | 'reconcile'>('all');
  const [activeDetailTab, setActiveDetailTab] = useState<'overview' | 'inventory' | 'transfers' | 'sales' | 'activity'>('overview');
  const [transferWarehouseId, setTransferWarehouseId] = useState('');
  const [transferAgentId, setTransferAgentId] = useState('');
  const [transferItemId, setTransferItemId] = useState('');
  const [transferItemQuery, setTransferItemQuery] = useState('');
  const [transferQty, setTransferQty] = useState('');
  const [transferLines, setTransferLines] = useState<Array<{ itemId: string; quantity: number }>>([]);
  const [transferNotes, setTransferNotes] = useState('');
  const [returnItemId, setReturnItemId] = useState('');
  const [returnQty, setReturnQty] = useState('');
  const [returnLines, setReturnLines] = useState<Array<{ itemId: string; quantity: number }>>([]);
  const [returnNotes, setReturnNotes] = useState('');
  const [reconcileItemId, setReconcileItemId] = useState('');
  const [reconcileQty, setReconcileQty] = useState('');
  const [reconcileMode, setReconcileMode] = useState<'adjust' | 'set'>('adjust');
  const [reconcileLines, setReconcileLines] = useState<Array<{ itemId: string; quantity: number }>>([]);
  const [reconcileNotes, setReconcileNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showOnlyAgentSales, setShowOnlyAgentSales] = useState(true);
  const [showAgentForm, setShowAgentForm] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showInventoryModal, setShowInventoryModal] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [showReconcileModal, setShowReconcileModal] = useState(false);
  const [syncIntervalSec, setSyncIntervalSec] = useState(10);
  const [contextMenu, setContextMenu] = useState<{ lat: number; lng: number; x: number; y: number } | null>(null);
  const [partyDraft, setPartyDraft] = useState<{
    type: PartyType;
    lat: number;
    lng: number;
    name: string;
    phone: string;
    address: string;
    label: string;
  } | null>(null);
  const [partyMarkers, setPartyMarkers] = useState<Array<{ id: string; name: string; type: PartyType; lat: number; lng: number }>>([]);

  const [form, setForm] = useState({
    name: '',
    phone: '',
    branchId: '',
    vehicle: '',
    vehicleImage: '',
    certificateImage: '',
    username: '',
    password: '',
    notes: '',
    commissionRate: '',
    commissionCurrency: 'USD'
  });
  const [agentFormError, setAgentFormError] = useState('');

  const selectedAgent = agents.find(a => a.id === selectedAgentId);
  const selectedAgentBranch = selectedAgent ? branches.find(b => b.id === selectedAgent.branchId)?.name : '';

  const mapCenter = useMemo(() => {
    if (selectedAgent?.lastLat && selectedAgent?.lastLng) {
      return [selectedAgent.lastLat, selectedAgent.lastLng] as [number, number];
    }
    const first = agents.find(a => a.lastLat && a.lastLng);
    if (first?.lastLat && first?.lastLng) return [first.lastLat, first.lastLng] as [number, number];
    return [33.5138, 36.2765] as [number, number];
  }, [agents, selectedAgent]);

  function isAgentOnline(agent: Agent) {
    if (!agent.lastSeenAt) return false;
    const last = Date.parse(agent.lastSeenAt);
    if (Number.isNaN(last)) return false;
    const windowMs = Math.max(5, syncIntervalSec) * 2000;
    return Date.now() - last <= windowMs;
  }

  const agentStats = useMemo(() => {
    const stats = new Map<string, { count: number; total: number; paid: number; remaining: number; soldQty: number }>();
    invoices.filter(i => i.type === 'sale').forEach((inv) => {
      const agentId = inv.agentId || (inv.createdByRole === 'agent' ? inv.createdById : undefined);
      if (!agentId) return;
      const current = stats.get(agentId) || { count: 0, total: 0, paid: 0, remaining: 0, soldQty: 0 };
      const lineQty = normalizeInvoiceItems(inv.items).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      stats.set(agentId, {
        count: current.count + 1,
        total: current.total + Number(inv.totalAmount || 0),
        paid: current.paid + Number(inv.paidAmount || 0),
        remaining: current.remaining + Number(inv.remainingAmount || 0),
        soldQty: current.soldQty + lineQty
      });
    });
    return stats;
  }, [invoices]);

  const saleInvoices = useMemo(() => {
    return invoices
      .filter(i => i.type === 'sale' && i.geoLat && i.geoLng)
      .filter(i => !showOnlyAgentSales || i.agentId || i.createdByRole === 'agent');
  }, [invoices, showOnlyAgentSales]);

  const filteredAgents = useMemo(() => {
    return agents.filter((agent) => {
      if (branchFilter && String(agent.branchId || '') !== String(branchFilter)) return false;
      if (statusFilter === 'active' && agent.isActive === false) return false;
      if (statusFilter === 'inactive' && agent.isActive !== false) return false;
      const online = isAgentOnline(agent);
      if (onlineFilter === 'online' && !online) return false;
      if (onlineFilter === 'offline' && online) return false;
      if (searchQuery) {
        const hay = `${agent.name || ''} ${agent.phone || ''}`.toLowerCase();
        if (!hay.includes(searchQuery.toLowerCase())) return false;
      }
      return true;
    });
  }, [agents, branchFilter, statusFilter, onlineFilter, searchQuery, syncIntervalSec]);

  const loadAgentInventory = async (agentId: string) => {
    if (!agentId) { setAgentInventory([]); return; }
    try {
      const data = await apiRequest(`agent-inventory?agentId=${agentId}`);
      setAgentInventory(data || []);
    } catch {
      setAgentInventory([]);
    }
  };

  const loadAgentTransfers = async (agentId: string) => {
    if (!agentId) { setAgentTransfers([]); return; }
    try {
      const data = await apiRequest(`agent-transfers?agentId=${agentId}`);
      setAgentTransfers(Array.isArray(data) ? data : []);
    } catch {
      setAgentTransfers([]);
    }
  };

  const loadAgentInventoryTotals = async () => {
    if (agents.length === 0) {
      setAgentInventoryTotals({});
      return;
    }
    try {
      const data = await apiRequest('agent-inventory/summary');
      const entries = (data || []).map((row: any) => [String(row.agentId || ''), Number(row.totalQty || 0)] as [string, number]);
      setAgentInventoryTotals(Object.fromEntries(entries));
    } catch {
      setAgentInventoryTotals({});
    }
  };

  const loadBranches = async () => {
    try {
      const data = await apiRequest('branches');
      setBranches(Array.isArray(data) ? data : []);
    } catch {
      setBranches([]);
    }
  };

  const loadPartyMarkers = async () => {
    try {
      const data = await apiRequest('parties');
      const markers = (data || [])
        .filter((party: any) => party.geoLat && party.geoLng)
        .map((party: any) => ({
          id: party.id,
          name: party.name,
          type: party.type,
          lat: party.geoLat,
          lng: party.geoLng
        }));
      setPartyMarkers(markers);
    } catch {
      setPartyMarkers([]);
    }
  };

  const loadSyncInterval = async () => {
    try {
      const data = await apiRequest('settings');
      const entry = (data || []).find((row: any) => row.key === 'agent_sync_interval');
      if (entry && Number(entry.value)) {
        setSyncIntervalSec(Number(entry.value));
      }
    } catch {
      setSyncIntervalSec(10);
    }
  };

  const saveSyncInterval = async (value: number) => {
    try {
      await apiRequest('settings', {
        method: 'POST',
        body: JSON.stringify({ key: 'agent_sync_interval', value })
      });
    } catch {
      alert('تعذر حفظ زمن التحديث.');
    }
  };

  useEffect(() => {
    loadSyncInterval();
    loadBranches();
  }, []);

  useEffect(() => {
    if (form.branchId) return;
    const storedUser = getStoredUser();
    const fallbackBranchId = getSelectedBranchId() || storedUser?.currentBranchId || storedUser?.defaultBranchId || branches[0]?.id || '';
    if (!fallbackBranchId) return;
    setForm(prev => ({ ...prev, branchId: prev.branchId || fallbackBranchId }));
  }, [branches, form.branchId]);

  useEffect(() => {
    loadAgentInventory(selectedAgentId);
    loadAgentTransfers(selectedAgentId);
  }, [selectedAgentId]);

  useEffect(() => {
    if (activeSection === 'map') {
      loadPartyMarkers();
    }
    if (activeSection === 'agents') {
      loadAgentInventoryTotals();
    }
  }, [activeSection, agents.length]);

  useEffect(() => {
    if (!syncIntervalSec) return;
    const timer = setInterval(() => {
      refreshData();
      if (activeSection === 'map') loadPartyMarkers();
      if (activeSection === 'agents') loadAgentInventoryTotals();
      if (selectedAgentId) {
        loadAgentInventory(selectedAgentId);
        loadAgentTransfers(selectedAgentId);
      }
    }, syncIntervalSec * 1000);
    return () => clearInterval(timer);
  }, [syncIntervalSec, activeSection, selectedAgentId]);

  const addTransferLine = () => {
    if (!transferItemId || !transferQty) return;
    const qty = Number(transferQty);
    if (!qty || qty <= 0) return;
    setTransferLines(prev => {
      const existing = prev.find(l => l.itemId === transferItemId);
      if (existing) {
        return prev.map(l => l.itemId === transferItemId ? { ...l, quantity: l.quantity + qty } : l);
      }
      return [...prev, { itemId: transferItemId, quantity: qty }];
    });
    setTransferItemId('');
    setTransferQty('');
  };

  const addReturnLine = () => {
    if (!returnItemId || !returnQty) return;
    const qty = Number(returnQty);
    if (!qty || qty <= 0) return;
    setReturnLines(prev => {
      const existing = prev.find(l => l.itemId === returnItemId);
      if (existing) {
        return prev.map(l => l.itemId === returnItemId ? { ...l, quantity: l.quantity + qty } : l);
      }
      return [...prev, { itemId: returnItemId, quantity: qty }];
    });
    setReturnItemId('');
    setReturnQty('');
  };

  const addReconcileLine = () => {
    if (!reconcileItemId || !reconcileQty) return;
    const qty = Number(reconcileQty);
    if (!Number.isFinite(qty) || qty === 0) return;
    setReconcileLines(prev => {
      const existing = prev.find(l => l.itemId === reconcileItemId);
      if (existing) {
        return prev.map(l => l.itemId === reconcileItemId ? { ...l, quantity: l.quantity + qty } : l);
      }
      return [...prev, { itemId: reconcileItemId, quantity: qty }];
    });
    setReconcileItemId('');
    setReconcileQty('');
  };

  const submitTransfer = async () => {
    if (!transferAgentId || !transferWarehouseId || transferLines.length === 0) return;
    setIsSubmitting(true);
    try {
      await apiRequest('agent-inventory/transfer', {
        method: 'POST',
        body: JSON.stringify({
          agentId: transferAgentId,
          warehouseId: transferWarehouseId,
          items: transferLines,
          notes: transferNotes
        })
      });
      setTransferLines([]);
      setTransferNotes('');
      await loadAgentInventory(transferAgentId);
      await refreshData();
      setShowTransferModal(false);
    } catch (e: any) {
      const err = e?.response?.data;
      if (err?.error === 'INSUFFICIENT_STOCK') {
        alert('الكمية المطلوبة غير متوفرة في المستودع.');
      } else {
        alert('تعذر ترحيل المخزون.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitReturn = async () => {
    if (!transferAgentId || !transferWarehouseId || returnLines.length === 0) return;
    setIsSubmitting(true);
    try {
      await apiRequest('agent-inventory/return', {
        method: 'POST',
        body: JSON.stringify({
          agentId: transferAgentId,
          warehouseId: transferWarehouseId,
          items: returnLines,
          notes: returnNotes
        })
      });
      setReturnLines([]);
      setReturnNotes('');
      await loadAgentInventory(transferAgentId);
      await refreshData();
      setShowReturnModal(false);
    } catch (e: any) {
      const err = e?.response?.data;
      if (err?.error === 'INSUFFICIENT_AGENT_STOCK') {
        alert('الكمية المطلوبة غير متاحة في مخزون المندوب.');
      } else {
        alert('تعذر تنفيذ المرتجع.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitReconcile = async () => {
    if (!transferAgentId || reconcileLines.length === 0) return;
    setIsSubmitting(true);
    try {
      await apiRequest('agent-inventory/reconcile', {
        method: 'POST',
        body: JSON.stringify({
          agentId: transferAgentId,
          warehouseId: transferWarehouseId,
          mode: reconcileMode,
          items: reconcileLines,
          notes: reconcileNotes
        })
      });
      setReconcileLines([]);
      setReconcileNotes('');
      await loadAgentInventory(transferAgentId);
      await refreshData();
      setShowReconcileModal(false);
    } catch (e: any) {
      alert('تعذر تنفيذ التسوية.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const readFileAsDataUrl = (file: File) => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('read failed'));
      reader.readAsDataURL(file);
    });
  };

const createAgent = async () => {
    if (!form.name.trim() || !form.username.trim() || !form.password || !form.branchId) {
      setAgentFormError('أكمل الاسم واسم المستخدم وكلمة المرور وحدد الفرع قبل الحفظ.');
      return;
    }
    setIsSubmitting(true);
    setAgentFormError('');
    const id = `u-${Date.now()}`;
    try {
      await apiRequest('agents/provision', {
        method: 'POST',
        body: JSON.stringify({
          id,
          name: form.name.trim(),
          username: form.username.trim(),
          password: form.password,
          branchId: form.branchId,
          permissions: DEFAULT_ROLE_PERMISSIONS.agent,
          phone: form.phone.trim(),
          vehicle: form.vehicle.trim(),
          vehicleImage: form.vehicleImage,
          certificateImage: form.certificateImage,
          notes: form.notes.trim(),
          commissionRate: Number(form.commissionRate || 0),
          commissionCurrency: form.commissionCurrency,
          isActive: true
        })
      });
      setAgents(prev => [...prev, {
        id,
        userId: id,
        branchId: form.branchId,
        name: form.name.trim(),
        phone: form.phone.trim(),
        vehicle: form.vehicle.trim(),
        vehicleImage: form.vehicleImage,
        certificateImage: form.certificateImage,
        notes: form.notes.trim(),
        commissionRate: Number(form.commissionRate || 0),
        commissionCurrency: form.commissionCurrency,
        isActive: true
      }]);
      setSelectedAgentId(id);
      setForm({
        name: '',
        phone: '',
        branchId: form.branchId,
        vehicle: '',
        vehicleImage: '',
        certificateImage: '',
        username: '',
        password: '',
        notes: '',
        commissionRate: '',
        commissionCurrency: 'USD'
      });
      setShowAgentForm(false);
    } catch (e: any) {
      const backendMessage = String(e?.response?.data?.error || e?.message || '').trim();
      if (backendMessage) {
        setAgentFormError(backendMessage);
        return;
      }
      setAgentFormError('تعذر إنشاء المندوب. تحقق من البيانات ثم أعد المحاولة.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateAgentLocation = async (lat: number, lng: number) => {
    if (!selectedAgentId) {
      alert('اختر مندوباً أولاً.');
      return;
    }
    try {
      await apiRequest(`agents/${selectedAgentId}/location`, {
        method: 'POST',
        body: JSON.stringify({ lat, lng })
      });
      setAgents(prev => prev.map(a => a.id === selectedAgentId ? { ...a, lastLat: lat, lastLng: lng, lastSeenAt: new Date().toISOString() } : a));
    } catch {
      alert('تعذر تحديث موقع المندوب.');
    }
  };

  const handleContextMenu = (lat: number, lng: number, x: number, y: number) => {
    setContextMenu({ lat, lng, x, y });
  };

  const createPartyFromMap = async () => {
    if (!partyDraft || !partyDraft.name.trim()) return;
    setIsSubmitting(true);
    try {
      const id = `p-${Date.now()}`;
      await apiRequest('parties', {
        method: 'POST',
        body: JSON.stringify({
          id,
          name: partyDraft.name.trim(),
          type: partyDraft.type,
          phone: partyDraft.phone.trim(),
          address: partyDraft.address.trim(),
          balance: 0,
          isActive: true,
          geoLat: partyDraft.lat,
          geoLng: partyDraft.lng,
          geoLabel: partyDraft.label.trim() || partyDraft.address.trim()
        })
      });
      setPartyMarkers(prev => [...prev, {
        id,
        name: partyDraft.name.trim(),
        type: partyDraft.type,
        lat: partyDraft.lat,
        lng: partyDraft.lng
      }]);
      setPartyDraft(null);
      await refreshData();
      await loadPartyMarkers();
    } catch {
      alert('تعذر إضافة عميل/مورد.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredItems = inventory
    .filter(i => !transferWarehouseId || i.warehouseId === transferWarehouseId)
    .filter(i => !transferItemQuery || i.name.toLowerCase().includes(transferItemQuery.toLowerCase()));

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="bg-sky-50 text-sky-700 p-3 rounded-2xl"><Truck size={22} /></div>
        <div>
          <h2 className="text-2xl font-black text-gray-900">المناديب</h2>
          <p className="text-xs text-gray-400 font-bold">إدارة المخزون المتحرك ومتابعة المبيعات والمواقع</p>
        </div>
      </div>

      {activeSection === 'agents' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => { setAgentFormError(''); setShowAgentForm(true); }} className="px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-bold flex items-center gap-2">
              <UserPlus size={16} /> إضافة مندوب
            </button>
            <button onClick={() => { setShowTransferModal(true); setTransferAgentId(selectedAgentId); }} className="px-4 py-2 rounded-xl bg-sky-600 text-white text-sm font-bold flex items-center gap-2">
              <Send size={16} /> ترحيل مواد للمندوب
            </button>
            <button onClick={() => { setShowReturnModal(true); setTransferAgentId(selectedAgentId); }} className="px-4 py-2 rounded-xl bg-amber-500 text-white text-sm font-bold flex items-center gap-2">
              <RotateCcw size={16} /> مرتجع من مندوب
            </button>
            <button onClick={() => { setShowReconcileModal(true); setTransferAgentId(selectedAgentId); }} className="px-4 py-2 rounded-xl bg-slate-700 text-white text-sm font-bold flex items-center gap-2">
              <ClipboardList size={16} /> تسوية مخزون
            </button>
            <button onClick={() => setActiveSection('map')} className="px-4 py-2 rounded-xl bg-white border text-gray-700 text-sm font-bold flex items-center gap-2">
              <MapPin size={16} /> عرض الخريطة الشاملة
            </button>
            <div className="flex items-center gap-2 bg-white border rounded-xl px-3 py-2 text-xs font-bold text-gray-600">
              زمن التحديث
              <select
                className="border rounded-lg px-2 py-1 text-xs"
                value={syncIntervalSec}
                onChange={(e) => {
                  const value = Number(e.target.value || 10);
                  setSyncIntervalSec(value);
                  saveSyncInterval(value);
                }}
              >
                {[5, 10, 15, 20, 30].map(v => <option key={v} value={v}>{v} ث</option>)}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 bg-white border rounded-2xl p-3 text-xs font-bold text-gray-600">
            <Filter size={14} className="text-gray-400" />
            <select className="border rounded-lg px-2 py-1 text-xs" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
              <option value="">كل الفروع</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <select className="border rounded-lg px-2 py-1 text-xs" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
              <option value="all">كل الحالات</option>
              <option value="active">نشط</option>
              <option value="inactive">غير نشط</option>
            </select>
            <select className="border rounded-lg px-2 py-1 text-xs" value={onlineFilter} onChange={(e) => setOnlineFilter(e.target.value as any)}>
              <option value="all">كل الاتصالات</option>
              <option value="online">متصل</option>
              <option value="offline">غير متصل</option>
            </select>
            <input className="border rounded-lg px-2 py-1 text-xs" placeholder="بحث بالاسم أو الهاتف" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          </div>

          {selectedAgent ? (
            <div className="bg-white rounded-2xl border shadow-sm p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-black text-gray-800">{selectedAgent.name}</div>
                  <div className="text-xs text-gray-400">{selectedAgent.phone || 'بدون هاتف'} • {selectedAgent.vehicle || 'بدون مركبة'}{selectedAgentBranch ? ` • ${selectedAgentBranch}` : ''}</div>
                </div>
                <div className="flex items-center gap-2 text-xs font-bold">
                  <span className={`h-2 w-2 rounded-full ${isAgentOnline(selectedAgent) ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  {isAgentOnline(selectedAgent) ? 'متصل' : 'غير متصل'}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-xs text-gray-400">اختر مندوباً لعرض العمليات.</div>
          )}

          {selectedAgent && (
            <div className="bg-white rounded-2xl border shadow-sm p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                {(['overview', 'inventory', 'transfers', 'sales', 'activity'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveDetailTab(tab)}
                    className={`px-3 py-1.5 rounded-xl border ${activeDetailTab === tab ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'}`}
                  >
                    {tab === 'overview' && 'نظرة عامة'}
                    {tab === 'inventory' && 'المخزون'}
                    {tab === 'transfers' && 'التحويلات'}
                    {tab === 'sales' && 'المبيعات'}
                    {tab === 'activity' && 'النشاط'}
                  </button>
                ))}
              </div>

              {activeDetailTab === 'overview' && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <div className="bg-slate-50 border rounded-xl p-3">
                    <div className="text-gray-400">آخر ظهور</div>
                    <div className="font-bold text-gray-800">{selectedAgent.lastSeenAt || 'غير متاح'}</div>
                  </div>
                  <div className="bg-slate-50 border rounded-xl p-3">
                    <div className="text-gray-400">مخزون المندوب</div>
                    <div className="font-bold text-gray-800">{(agentInventoryTotals[selectedAgent.id] ?? 0).toLocaleString()}</div>
                  </div>
                  <div className="bg-slate-50 border rounded-xl p-3">
                    <div className="text-gray-400">عدد المبيعات</div>
                    <div className="font-bold text-gray-800">{(agentStats.get(selectedAgent.id)?.count || 0)}</div>
                  </div>
                  <div className="bg-slate-50 border rounded-xl p-3">
                    <div className="text-gray-400">إجمالي المبيعات</div>
                    <div className="font-bold text-gray-800">{(agentStats.get(selectedAgent.id)?.total || 0).toLocaleString()}</div>
                  </div>
                </div>
              )}

              {activeDetailTab === 'inventory' && (
                <div className="max-h-56 overflow-y-auto custom-scrollbar text-xs">
                  {agentInventory.length === 0 ? (
                    <div className="text-gray-400">لا يوجد مخزون.</div>
                  ) : (
                    agentInventory.map(line => (
                      <div key={line.id} className="flex items-center justify-between border-b py-1">
                        <span>{line.itemName || line.itemId}</span>
                        <span className="font-bold">{Number(line.quantity || 0).toLocaleString()}</span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeDetailTab === 'transfers' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <select className="border rounded-lg px-2 py-1 text-xs" value={transferTypeFilter} onChange={(e) => setTransferTypeFilter(e.target.value as any)}>
                      <option value="all">كل التحويلات</option>
                      <option value="transfer">تسليم</option>
                      <option value="return">مرتجع</option>
                      <option value="reconcile">تسوية</option>
                    </select>
                  </div>
                  <div className="max-h-56 overflow-y-auto custom-scrollbar text-xs">
                    {agentTransfers.filter(t => transferTypeFilter === 'all' || t.transferType === transferTypeFilter).length === 0 ? (
                      <div className="text-gray-400">لا يوجد تحويلات.</div>
                    ) : (
                      agentTransfers
                        .filter(t => transferTypeFilter === 'all' || t.transferType === transferTypeFilter)
                        .map((t) => (
                          <div key={t.id} className="border rounded-xl p-2 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-gray-700">{t.transferType || 'transfer'}</span>
                              <span className="text-gray-400">{t.createdAt || ''}</span>
                            </div>
                            <div className="text-gray-500">{t.warehouseName || ''}</div>
                            <div className="text-gray-500">{(t.items || []).length} صنف</div>
                          </div>
                        ))
                    )}
                  </div>
                </div>
              )}

              {activeDetailTab === 'sales' && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  <div className="bg-emerald-50 border rounded-xl p-3">
                    <div className="text-emerald-700">المبيعات</div>
                    <div className="font-bold text-emerald-900">{(agentStats.get(selectedAgent.id)?.total || 0).toLocaleString()}</div>
                  </div>
                  <div className="bg-sky-50 border rounded-xl p-3">
                    <div className="text-sky-700">المقبوض</div>
                    <div className="font-bold text-sky-900">{(agentStats.get(selectedAgent.id)?.paid || 0).toLocaleString()}</div>
                  </div>
                  <div className="bg-rose-50 border rounded-xl p-3">
                    <div className="text-rose-700">المتبقي</div>
                    <div className="font-bold text-rose-900">{(agentStats.get(selectedAgent.id)?.remaining || 0).toLocaleString()}</div>
                  </div>
                  <div className="bg-slate-50 border rounded-xl p-3">
                    <div className="text-gray-400">مواد مباعة</div>
                    <div className="font-bold text-gray-800">{(agentStats.get(selectedAgent.id)?.soldQty || 0).toLocaleString()}</div>
                  </div>
                </div>
              )}

              {activeDetailTab === 'activity' && (
                <div className="space-y-2 text-xs text-gray-600">
                  <div className="flex items-center gap-2">
                    <Activity size={14} className="text-gray-400" />
                    <span>آخر ظهور: {selectedAgent.lastSeenAt || 'غير متاح'}</span>
                  </div>
                  <div className="text-gray-500">الموقع: {selectedAgent.lastLat ? `${selectedAgent.lastLat}, ${selectedAgent.lastLng}` : 'غير متاح'}</div>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filteredAgents.map((agent) => {
              const stats = agentStats.get(agent.id) || { count: 0, total: 0, paid: 0, remaining: 0, soldQty: 0 };
              const commissionRate = Number(agent.commissionRate || 0);
              const commissionAmount = stats.total * (commissionRate / 100);
              const isActive = selectedAgentId === agent.id;
              const remainingQty = agentInventoryTotals[agent.id] ?? 0;
              const online = isAgentOnline(agent);
              return (
                <button
                  key={agent.id}
                  onClick={() => setSelectedAgentId(agent.id)}
                  className={`w-full text-right p-4 rounded-2xl border shadow-sm transition ${isActive ? 'border-sky-600 bg-sky-50' : 'border-gray-100 bg-white'}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-black text-gray-800">{agent.name}</div>
                    <div className="flex items-center gap-2 text-[10px] font-bold">
                      <span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-red-500'}`} />
                      <span className="text-gray-500">{online ? 'متصل' : 'غير متصل'}</span>
                    </div>
                  </div>
                  <div className="text-[11px] text-gray-400 mt-1">{agent.phone || 'بدون هاتف'} • {agent.vehicle || 'بدون مركبة'}</div>
                  <div className="grid grid-cols-2 gap-2 mt-3 text-[11px]">
                    <div className="bg-white border rounded-lg p-2">
                      <div className="text-gray-400">عدد الفواتير</div>
                      <div className="font-bold text-gray-800">{stats.count}</div>
                    </div>
                    <div className="bg-white border rounded-lg p-2">
                      <div className="text-gray-400">إجمالي المبيعات</div>
                      <div className="font-bold text-gray-800">{stats.total.toLocaleString()} {agent.commissionCurrency || 'USD'}</div>
                    </div>
                    <div className="bg-white border rounded-lg p-2">
                      <div className="text-gray-400">المقبوض</div>
                      <div className="font-bold text-emerald-600">{stats.paid.toLocaleString()}</div>
                    </div>
                    <div className="bg-white border rounded-lg p-2">
                      <div className="text-gray-400">المتبقي</div>
                      <div className="font-bold text-red-600">{stats.remaining.toLocaleString()}</div>
                    </div>
                    <div className="bg-white border rounded-lg p-2">
                      <div className="text-gray-400">مواد مباعة</div>
                      <div className="font-bold text-gray-800">{stats.soldQty.toLocaleString()}</div>
                    </div>
                    <div className="bg-white border rounded-lg p-2">
                      <div className="text-gray-400">مواد متبقية</div>
                      <div className="font-bold text-gray-800">{remainingQty.toLocaleString()}</div>
                    </div>
                    <div className="bg-white border rounded-lg p-2 col-span-2">
                      <div className="text-gray-400">عمولة المندوب</div>
                      <div className="font-bold text-sky-700">{commissionRate}% = {commissionAmount.toLocaleString()} {agent.commissionCurrency || 'USD'}</div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-[10px] font-bold px-2 py-1 rounded-full" style={{ backgroundColor: `${getAgentColor(agents, agent.id)}22`, color: getAgentColor(agents, agent.id) }}>
                      مندوب
                    </span>
                    {agent.vehicleImage && <span className="text-[10px] text-gray-500">صورة مركبة</span>}
                    {agent.certificateImage && <span className="text-[10px] text-gray-500">شهادة</span>}
                  </div>
                </button>
              );
            })}
            {filteredAgents.length === 0 && (
              <div className="text-xs text-gray-400">لا يوجد مناديب بعد.</div>
            )}
          </div>
        </div>
      )}

      {activeSection === 'map' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-bold text-gray-700 bg-white border rounded-2xl px-4 py-2">
              <MapPin size={16} className="text-sky-600" />
              خريطة المناديب والعملاء والموردين
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setActiveSection('agents')} className="px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-bold">
                عودة للمناديب
              </button>
              <label className="text-xs font-bold text-gray-600 flex items-center gap-2 bg-white border rounded-xl px-3 py-2">
                <input type="checkbox" checked={showOnlyAgentSales} onChange={e => setShowOnlyAgentSales(e.target.checked)} />
                عرض مبيعات المناديب فقط
              </label>
            </div>
          </div>

          <div className="bg-white rounded-2xl border shadow-sm overflow-hidden relative">
            <MapContainer center={mapCenter} zoom={13} className="h-[360px] md:h-[520px] w-full">
              <TileLayer
                attribution="&copy; OpenStreetMap contributors"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <MapInteractionHandler
                onPick={(lat, lng) => updateAgentLocation(lat, lng)}
                onContext={handleContextMenu}
                onClearContext={() => setContextMenu(null)}
              />

              {filteredAgents.filter(a => a.lastLat && a.lastLng).map(agent => (
                <CircleMarker
                  key={agent.id}
                  center={[agent.lastLat as number, agent.lastLng as number]}
                  pathOptions={{ color: getAgentColor(agents, agent.id), fillColor: getAgentColor(agents, agent.id), fillOpacity: 0.85 }}
                  radius={8}
                  eventHandlers={{ click: () => setSelectedAgentId(agent.id) }}
                >
                  <Popup>
                    <div className="text-sm font-bold">{agent.name}</div>
                    <div className="text-xs text-gray-500">{agent.phone || 'بدون هاتف'}</div>
                    <div className="text-xs text-gray-500">{agent.lastSeenAt ? `آخر ظهور: ${agent.lastSeenAt}` : ''}</div>
                  </Popup>
                </CircleMarker>
              ))}

              {saleInvoices.map(inv => {
                const markerAgentId = inv.agentId || (inv.createdByRole === 'agent' ? inv.createdById : undefined);
                const color = markerAgentId ? getAgentColor(agents, markerAgentId) : '#2563eb';
                return (
                  <CircleMarker
                    key={inv.id}
                    center={[inv.geoLat as number, inv.geoLng as number]}
                    pathOptions={{ color, fillColor: color, fillOpacity: 0.8 }}
                    radius={6}
                  >
                    <Popup>
                      <div className="text-sm font-bold">فاتورة رقم {inv.invoiceNumber}</div>
                      <div className="text-xs text-gray-500">{inv.clientName || '-'}</div>
                      <div className="text-xs text-gray-500">{inv.createdByName || ''}</div>
                      <div className="text-xs text-gray-500">{inv.date}</div>
                    </Popup>
                  </CircleMarker>
                );
              })}

              {partyMarkers.map(p => (
                <CircleMarker
                  key={p.id}
                  center={[p.lat, p.lng]}
                  pathOptions={{ color: p.type === 'CUSTOMER' ? '#10b981' : '#f97316', fillColor: p.type === 'CUSTOMER' ? '#10b981' : '#f97316', fillOpacity: 0.85 }}
                  radius={6}
                >
                  <Popup>
                    <div className="text-sm font-bold">{p.name}</div>
                    <div className="text-xs text-gray-500">{p.type === 'CUSTOMER' ? 'عميل' : 'مورد'}</div>
                  </Popup>
                </CircleMarker>
              ))}
            </MapContainer>
            <div className="p-3 text-[11px] text-gray-500">
              نقرة يسار لتحديث موقع المندوب المحدد. نقرة يمين لإضافة عميل أو مورد على الخريطة.
            </div>
            <div className="px-3 pb-3 text-[11px] text-gray-500 flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-500" /> مندوب</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> عميل</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-orange-500" /> مورد</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-600" /> فاتورة</span>
            </div>

            {contextMenu && (
              <div
                className="fixed z-[400] bg-white border shadow-lg rounded-lg text-xs"
                style={{ top: contextMenu.y, left: contextMenu.x }}
              >
                <button
                  className="block w-full text-right px-4 py-2 hover:bg-gray-50"
                  onClick={() => {
                    setPartyDraft({ type: 'CUSTOMER', lat: contextMenu.lat, lng: contextMenu.lng, name: '', phone: '', address: '', label: '' });
                    setContextMenu(null);
                  }}
                >
                  إضافة عميل
                </button>
                <button
                  className="block w-full text-right px-4 py-2 hover:bg-gray-50"
                  onClick={() => {
                    setPartyDraft({ type: 'SUPPLIER', lat: contextMenu.lat, lng: contextMenu.lng, name: '', phone: '', address: '', label: '' });
                    setContextMenu(null);
                  }}
                >
                  إضافة مورد
                </button>
                <button className="block w-full text-right px-4 py-2 text-gray-400" onClick={() => setContextMenu(null)}>
                  إغلاق
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showAgentForm && (
        <AdaptiveModal open={showAgentForm} onClose={() => setShowAgentForm(false)} size="xl" zIndex={300} panelClassName={modalPanelClassName}>
          <div dir="rtl" className="w-full max-w-5xl overflow-hidden rounded-[2rem] border border-slate-200 bg-white text-right shadow-[0_30px_100px_rgba(15,23,42,0.2)]">
            <div className="relative overflow-hidden bg-[linear-gradient(135deg,#0f172a_0%,#1d4ed8_55%,#38bdf8_100%)] px-6 py-7 text-white md:px-8">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.22),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(125,211,252,0.22),transparent_30%)]" />
              <div className="relative flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="space-y-3">
                  <div className="inline-flex items-center gap-2 self-start rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-black tracking-[0.18em] text-white/90">
                    <UserPlus size={14} />
                    ملف المندوب
                  </div>
                  <div>
                    <h3 className="text-2xl font-black md:text-3xl">{AGENT_FORM_COPY.title}</h3>
                    <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-sky-50/90">
                      {AGENT_FORM_COPY.subtitle}
                    </p>
                  </div>
                </div>
                <div className="rounded-3xl border border-white/15 bg-white/10 px-4 py-3 text-xs font-bold text-sky-50 backdrop-blur md:min-w-[220px]">
                  <div>{AGENT_FORM_COPY.branchBadge}</div>
                  <div className="mt-1 text-sm font-black text-white">
                    {branches.find((branch) => String(branch.id) === String(form.branchId))?.name || AGENT_FORM_COPY.branchFallback}
                  </div>
                </div>
              </div>
            </div>
            <div className="grid gap-0 md:grid-cols-[1.05fr_0.95fr]">
              <div className="space-y-5 bg-slate-50 px-6 py-6 md:px-8">
                <div className="text-xs font-black tracking-[0.18em] text-slate-400">{AGENT_FORM_COPY.identity}</div>
                <div className="grid grid-cols-1 gap-3">
                  <input className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100" placeholder={AGENT_FORM_COPY.name} value={form.name} onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} />
                  <input className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100" placeholder={AGENT_FORM_COPY.phone} value={form.phone} onChange={e => setForm(prev => ({ ...prev, phone: e.target.value }))} />
                  <select className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100" value={form.branchId} onChange={e => setForm(prev => ({ ...prev, branchId: e.target.value }))}>
                    <option value="">{AGENT_FORM_COPY.branch}</option>
                    {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                  </select>
                  <input className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100" placeholder={AGENT_FORM_COPY.vehicle} value={form.vehicle} onChange={e => setForm(prev => ({ ...prev, vehicle: e.target.value }))} />
                  <input className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100" placeholder={AGENT_FORM_COPY.username} value={form.username} onChange={e => setForm(prev => ({ ...prev, username: e.target.value }))} />
                  <input className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100" placeholder={AGENT_FORM_COPY.password} type="password" value={form.password} onChange={e => setForm(prev => ({ ...prev, password: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-5 px-6 py-6 md:px-8">
                <div className="rounded-[1.6rem] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-5">
                  <div className="text-xs font-black tracking-[0.18em] text-slate-400">{AGENT_FORM_COPY.commissionAndFiles}</div>
                  <div className="mt-3 grid gap-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <input className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100" placeholder={AGENT_FORM_COPY.commission} value={form.commissionRate} onChange={e => setForm(prev => ({ ...prev, commissionRate: e.target.value }))} />
                      <select className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-800 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100" value={form.commissionCurrency} onChange={e => setForm(prev => ({ ...prev, commissionCurrency: e.target.value }))}>
                        <option value="USD">USD</option>
                        <option value="TRY">TRY</option>
                        <option value="SYP">SYP</option>
                      </select>
                    </div>
                    <label className="space-y-2">
                      <span className="text-xs font-bold text-slate-600">{AGENT_FORM_COPY.vehicleImage}</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="w-full rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-xs font-bold text-slate-500"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const dataUrl = await readFileAsDataUrl(file);
                          setForm(prev => ({ ...prev, vehicleImage: dataUrl }));
                        }}
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="text-xs font-bold text-slate-600">{AGENT_FORM_COPY.permitImage}</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="w-full rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-xs font-bold text-slate-500"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const dataUrl = await readFileAsDataUrl(file);
                          setForm(prev => ({ ...prev, certificateImage: dataUrl }));
                        }}
                      />
                    </label>
                    <textarea className="min-h-[110px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100" placeholder={AGENT_FORM_COPY.notes} value={form.notes} onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))} />
                  </div>
                </div>
                <div className="rounded-[1.6rem] border border-slate-200 bg-slate-950 px-5 py-4 text-white">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-black tracking-[0.18em] text-slate-400">{AGENT_FORM_COPY.readiness}</div>
                      <div className="mt-1 text-sm font-bold text-slate-100">{AGENT_FORM_COPY.readinessBody}</div>
                    </div>
                    <div className="rounded-2xl bg-white/10 px-3 py-2 text-center text-xs font-black text-sky-100">
                      {DEFAULT_ROLE_PERMISSIONS.agent.length} {AGENT_FORM_COPY.permissions}
                    </div>
                  </div>
                </div>
                {agentFormError && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
                    {agentFormError}
                  </div>
                )}
                <div className="flex flex-col-reverse gap-3 pt-2 md:flex-row md:justify-end">
                  <button onClick={() => setShowAgentForm(false)} className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-black text-slate-500 transition hover:border-slate-300 hover:text-slate-700">{AGENT_FORM_COPY.cancel}</button>
                  <button onClick={createAgent} disabled={isSubmitting || branches.length === 0} className="rounded-2xl bg-[linear-gradient(135deg,#0f172a_0%,#2563eb_100%)] px-5 py-3 text-sm font-black text-white shadow-lg shadow-sky-200 transition hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-60">
                    {isSubmitting ? AGENT_FORM_COPY.submitting : AGENT_FORM_COPY.submit}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </AdaptiveModal>
      )}

      {showTransferModal && (
        <AdaptiveModal open={showTransferModal} onClose={() => setShowTransferModal(false)} size="xl" zIndex={300} panelClassName={modalPanelClassName}>
          <div dir="rtl" className={`${modalShellClassName} max-w-5xl text-right`}>
            <div className="relative overflow-hidden bg-[linear-gradient(135deg,#0f172a_0%,#0ea5e9_58%,#67e8f9_100%)] px-6 py-7 text-white md:px-8">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.2),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(125,211,252,0.22),transparent_32%)]" />
              <div className="relative flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 self-start rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-black tracking-[0.18em]">{TRANSFER_MODAL_COPY.badge}</div>
                  <h3 className="mt-3 text-2xl font-black md:text-3xl">{TRANSFER_MODAL_COPY.title}</h3>
                  <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-sky-50/90">{TRANSFER_MODAL_COPY.subtitle}</p>
                </div>
                <div className="rounded-3xl border border-white/15 bg-white/10 px-4 py-3 text-xs font-bold text-sky-50 backdrop-blur md:min-w-[220px]">
                  <div>{TRANSFER_MODAL_COPY.count}</div>
                  <div className="mt-1 text-2xl font-black text-white">{transferLines.length}</div>
                  <div className="mt-1 text-[11px] text-sky-100">{TRANSFER_MODAL_COPY.countHint}</div>
                </div>
              </div>
            </div>
            <div className="grid gap-0 md:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-5 bg-slate-50 px-6 py-6 md:px-8">
                <div className="text-xs font-black tracking-[0.18em] text-slate-400">{TRANSFER_MODAL_COPY.section}</div>
                <div className="grid gap-3">
                  <select className={modalFieldClassName} value={transferAgentId} onChange={e => setTransferAgentId(e.target.value)}>
                    <option value="">{TRANSFER_MODAL_COPY.selectAgent}</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <select className={modalFieldClassName} value={transferWarehouseId} onChange={e => setTransferWarehouseId(e.target.value)}>
                    <option value="">{TRANSFER_MODAL_COPY.selectWarehouse}</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                  <input className={modalFieldClassName} placeholder={TRANSFER_MODAL_COPY.searchItem} value={transferItemQuery} onChange={e => setTransferItemQuery(e.target.value)} />
                  <select className={modalFieldClassName} value={transferItemId} onChange={e => setTransferItemId(e.target.value)}>
                    <option value="">{TRANSFER_MODAL_COPY.selectItem}</option>
                    {filteredItems.map(i => (
                      <option key={i.id} value={i.id}>
                        {i.name} ({TRANSFER_MODAL_COPY.available}: {i.quantity})
                      </option>
                    ))}
                  </select>
                  <input className={modalFieldClassName} placeholder={TRANSFER_MODAL_COPY.quantity} type="number" value={transferQty} onChange={e => setTransferQty(e.target.value)} />
                  <button onClick={addTransferLine} className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700">
                    <Plus size={16} /> {TRANSFER_MODAL_COPY.addLine}
                  </button>
                  <textarea className={modalFieldClassName} placeholder={TRANSFER_MODAL_COPY.notes} value={transferNotes} onChange={e => setTransferNotes(e.target.value)} rows={3} />
                </div>
              </div>
              <div className="space-y-5 px-6 py-6 md:px-8">
                <div className={modalListPanelClassName}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-black tracking-[0.18em] text-slate-400">{TRANSFER_MODAL_COPY.summary}</div>
                      <div className="mt-1 text-sm font-bold text-slate-700">{TRANSFER_MODAL_COPY.summaryBody}</div>
                    </div>
                    <div className="rounded-2xl bg-sky-50 px-3 py-2 text-center text-xs font-black text-sky-700">
                      {TRANSFER_MODAL_COPY.totalQty}: {transferLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0)}
                    </div>
                  </div>
                  <div className="mt-4 max-h-64 space-y-2 overflow-y-auto custom-scrollbar">
                    {transferLines.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm font-bold text-slate-400">{TRANSFER_MODAL_COPY.empty}</div>
                    ) : (
                      transferLines.map((line, idx) => (
                        <div key={idx} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm">
                          <div>
                            <div className="font-black text-slate-800">{inventory.find(i => i.id === line.itemId)?.name || line.itemId}</div>
                            <div className="text-xs font-bold text-slate-400">{TRANSFER_MODAL_COPY.line} {idx + 1}</div>
                          </div>
                          <div className="rounded-2xl bg-sky-50 px-3 py-2 text-sm font-black text-sky-700">{line.quantity}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div className="rounded-[1.6rem] border border-slate-200 bg-slate-950 px-5 py-4 text-white">
                  <div className="text-xs font-black tracking-[0.18em] text-slate-400">{TRANSFER_MODAL_COPY.safety}</div>
                  <div className="mt-2 text-sm font-bold text-slate-100">{TRANSFER_MODAL_COPY.safetyBody}</div>
                </div>
                <div className="flex flex-col-reverse gap-3 pt-2 md:flex-row md:justify-end">
                  <button onClick={() => setShowTransferModal(false)} className={modalGhostButtonClassName}>{TRANSFER_MODAL_COPY.close}</button>
                  <button onClick={submitTransfer} disabled={isSubmitting || !transferAgentId || transferLines.length === 0 || !transferWarehouseId} className="rounded-2xl bg-[linear-gradient(135deg,#0369a1_0%,#0ea5e9_100%)] px-5 py-3 text-sm font-black text-white shadow-lg shadow-sky-200 transition hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-60">
                    {isSubmitting ? TRANSFER_MODAL_COPY.submitting : TRANSFER_MODAL_COPY.submit}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </AdaptiveModal>
      )}

      {showReturnModal && (
        <AdaptiveModal open={showReturnModal} onClose={() => setShowReturnModal(false)} size="xl" zIndex={300} panelClassName={modalPanelClassName}>
          <div dir="rtl" className={`${modalShellClassName} max-w-5xl text-right`}>
            <div className="relative overflow-hidden bg-[linear-gradient(135deg,#7c2d12_0%,#f59e0b_55%,#fde68a_100%)] px-6 py-7 text-white md:px-8">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.18),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(254,240,138,0.22),transparent_34%)]" />
              <div className="relative flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 self-start rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-black tracking-[0.18em]">{RETURN_MODAL_COPY.badge}</div>
                  <h3 className="mt-3 text-2xl font-black md:text-3xl">{RETURN_MODAL_COPY.title}</h3>
                  <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-amber-50/90">{RETURN_MODAL_COPY.subtitle}</p>
                </div>
                <div className="rounded-3xl border border-white/15 bg-white/10 px-4 py-3 text-xs font-bold text-amber-50 backdrop-blur md:min-w-[220px]">
                  <div>{RETURN_MODAL_COPY.count}</div>
                  <div className="mt-1 text-2xl font-black text-white">{returnLines.length}</div>
                  <div className="mt-1 text-[11px] text-amber-100">{RETURN_MODAL_COPY.countHint}</div>
                </div>
              </div>
            </div>
            <div className="grid gap-0 md:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-5 bg-amber-50/40 px-6 py-6 md:px-8">
                <div className="text-xs font-black tracking-[0.18em] text-slate-400">{RETURN_MODAL_COPY.section}</div>
                <div className="grid gap-3">
                  <select className={modalFieldClassName} value={transferAgentId} onChange={e => { setTransferAgentId(e.target.value); loadAgentInventory(e.target.value); }}>
                    <option value="">{RETURN_MODAL_COPY.selectAgent}</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <select className={modalFieldClassName} value={transferWarehouseId} onChange={e => setTransferWarehouseId(e.target.value)}>
                    <option value="">{RETURN_MODAL_COPY.selectWarehouse}</option>
                    {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                  <select className={modalFieldClassName} value={returnItemId} onChange={e => setReturnItemId(e.target.value)}>
                    <option value="">{RETURN_MODAL_COPY.selectItem}</option>
                    {agentInventory.map(i => (
                      <option key={i.itemId} value={i.itemId}>{i.itemName || i.itemId} ({RETURN_MODAL_COPY.available}: {i.quantity})</option>
                    ))}
                  </select>
                  <input className={modalFieldClassName} placeholder={RETURN_MODAL_COPY.quantity} type="number" value={returnQty} onChange={e => setReturnQty(e.target.value)} />
                  <button onClick={addReturnLine} className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700">
                    <Plus size={16} /> {RETURN_MODAL_COPY.addLine}
                  </button>
                  <textarea className={modalFieldClassName} placeholder={RETURN_MODAL_COPY.notes} value={returnNotes} onChange={e => setReturnNotes(e.target.value)} rows={3} />
                </div>
              </div>
              <div className="space-y-5 px-6 py-6 md:px-8">
                <div className={modalListPanelClassName}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-black tracking-[0.18em] text-slate-400">{RETURN_MODAL_COPY.summary}</div>
                      <div className="mt-1 text-sm font-bold text-slate-700">{RETURN_MODAL_COPY.summaryBody}</div>
                    </div>
                    <div className="rounded-2xl bg-amber-50 px-3 py-2 text-center text-xs font-black text-amber-700">
                      {RETURN_MODAL_COPY.totalQty}: {returnLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0)}
                    </div>
                  </div>
                  <div className="mt-4 max-h-64 space-y-2 overflow-y-auto custom-scrollbar">
                    {returnLines.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm font-bold text-slate-400">{RETURN_MODAL_COPY.empty}</div>
                    ) : (
                      returnLines.map((line, idx) => (
                        <div key={idx} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm">
                          <div>
                            <div className="font-black text-slate-800">{inventory.find(i => i.id === line.itemId)?.name || line.itemId}</div>
                            <div className="text-xs font-bold text-slate-400">{RETURN_MODAL_COPY.line} {idx + 1}</div>
                          </div>
                          <div className="rounded-2xl bg-amber-50 px-3 py-2 text-sm font-black text-amber-700">{line.quantity}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div className="rounded-[1.6rem] border border-slate-200 bg-slate-950 px-5 py-4 text-white">
                  <div className="text-xs font-black tracking-[0.18em] text-slate-400">{RETURN_MODAL_COPY.safety}</div>
                  <div className="mt-2 text-sm font-bold text-slate-100">{RETURN_MODAL_COPY.safetyBody}</div>
                </div>
                <div className="flex flex-col-reverse gap-3 pt-2 md:flex-row md:justify-end">
                  <button onClick={() => setShowReturnModal(false)} className={modalGhostButtonClassName}>{RETURN_MODAL_COPY.close}</button>
                  <button onClick={submitReturn} disabled={isSubmitting || !transferAgentId || returnLines.length === 0 || !transferWarehouseId} className="rounded-2xl bg-[linear-gradient(135deg,#b45309_0%,#f59e0b_100%)] px-5 py-3 text-sm font-black text-white shadow-lg shadow-amber-200 transition hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-60">
                    {isSubmitting ? RETURN_MODAL_COPY.submitting : RETURN_MODAL_COPY.submit}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </AdaptiveModal>
      )}

      {showReconcileModal && (
        <AdaptiveModal open={showReconcileModal} onClose={() => setShowReconcileModal(false)} size="xl" zIndex={300} panelClassName={modalPanelClassName}>
          <div dir="rtl" className={`${modalShellClassName} max-w-5xl text-right`}>
            <div className="relative overflow-hidden bg-[linear-gradient(135deg,#111827_0%,#475569_55%,#cbd5e1_100%)] px-6 py-7 text-white md:px-8">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.16),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(203,213,225,0.18),transparent_34%)]" />
              <div className="relative flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 self-start rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-black tracking-[0.18em]">{RECONCILE_MODAL_COPY.badge}</div>
                  <h3 className="mt-3 text-2xl font-black md:text-3xl">{RECONCILE_MODAL_COPY.title}</h3>
                  <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-100/90">{RECONCILE_MODAL_COPY.subtitle}</p>
                </div>
                <div className="rounded-3xl border border-white/15 bg-white/10 px-4 py-3 text-xs font-bold text-slate-100 backdrop-blur md:min-w-[220px]">
                  <div>{RECONCILE_MODAL_COPY.count}</div>
                  <div className="mt-1 text-2xl font-black text-white">{reconcileLines.length}</div>
                  <div className="mt-1 text-[11px] text-slate-200">{RECONCILE_MODAL_COPY.countHint}</div>
                </div>
              </div>
            </div>
            <div className="grid gap-0 md:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-5 bg-slate-50 px-6 py-6 md:px-8">
                <div className="text-xs font-black tracking-[0.18em] text-slate-400">{RECONCILE_MODAL_COPY.section}</div>
                <div className="grid gap-3">
                  <select className={modalFieldClassName} value={transferAgentId} onChange={e => { setTransferAgentId(e.target.value); loadAgentInventory(e.target.value); }}>
                    <option value="">{RECONCILE_MODAL_COPY.selectAgent}</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <select className={modalFieldClassName} value={reconcileMode} onChange={e => setReconcileMode(e.target.value as any)}>
                    <option value="adjust">{RECONCILE_MODAL_COPY.modeAdjust}</option>
                    <option value="set">{RECONCILE_MODAL_COPY.modeSet}</option>
                  </select>
                  <select className={modalFieldClassName} value={reconcileItemId} onChange={e => setReconcileItemId(e.target.value)}>
                    <option value="">{RECONCILE_MODAL_COPY.selectItem}</option>
                    {agentInventory.map(i => (
                      <option key={i.itemId} value={i.itemId}>{i.itemName || i.itemId} ({RECONCILE_MODAL_COPY.available}: {i.quantity})</option>
                    ))}
                  </select>
                  <input className={modalFieldClassName} placeholder={reconcileMode === 'set' ? RECONCILE_MODAL_COPY.setQty : RECONCILE_MODAL_COPY.adjustQty} type="number" value={reconcileQty} onChange={e => setReconcileQty(e.target.value)} />
                  <button onClick={addReconcileLine} className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 transition hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900">
                    <Plus size={16} /> {RECONCILE_MODAL_COPY.addLine}
                  </button>
                  <textarea className={modalFieldClassName} placeholder={RECONCILE_MODAL_COPY.notes} value={reconcileNotes} onChange={e => setReconcileNotes(e.target.value)} rows={3} />
                </div>
              </div>
              <div className="space-y-5 px-6 py-6 md:px-8">
                <div className={modalListPanelClassName}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-black tracking-[0.18em] text-slate-400">{RECONCILE_MODAL_COPY.summary}</div>
                      <div className="mt-1 text-sm font-bold text-slate-700">{RECONCILE_MODAL_COPY.summaryBody}</div>
                    </div>
                    <div className="rounded-2xl bg-slate-100 px-3 py-2 text-center text-xs font-black text-slate-700">{RECONCILE_MODAL_COPY.totalLines}: {reconcileLines.length}</div>
                  </div>
                  <div className="mt-4 max-h-64 space-y-2 overflow-y-auto custom-scrollbar">
                    {reconcileLines.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm font-bold text-slate-400">{RECONCILE_MODAL_COPY.empty}</div>
                    ) : (
                      reconcileLines.map((line, idx) => (
                        <div key={idx} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm">
                          <div>
                            <div className="font-black text-slate-800">{inventory.find(i => i.id === line.itemId)?.name || line.itemId}</div>
                            <div className="text-xs font-bold text-slate-400">{RECONCILE_MODAL_COPY.line} {idx + 1}</div>
                          </div>
                          <div className="rounded-2xl bg-slate-100 px-3 py-2 text-sm font-black text-slate-700">{line.quantity}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div className="rounded-[1.6rem] border border-slate-200 bg-slate-950 px-5 py-4 text-white">
                  <div className="text-xs font-black tracking-[0.18em] text-slate-400">{RECONCILE_MODAL_COPY.safety}</div>
                  <div className="mt-2 text-sm font-bold text-slate-100">{RECONCILE_MODAL_COPY.safetyBody}</div>
                </div>
                <div className="flex flex-col-reverse gap-3 pt-2 md:flex-row md:justify-end">
                  <button onClick={() => setShowReconcileModal(false)} className={modalGhostButtonClassName}>{RECONCILE_MODAL_COPY.close}</button>
                  <button onClick={submitReconcile} disabled={isSubmitting || !transferAgentId || reconcileLines.length === 0} className="rounded-2xl bg-[linear-gradient(135deg,#0f172a_0%,#475569_100%)] px-5 py-3 text-sm font-black text-white shadow-lg shadow-slate-300 transition hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-60">
                    {isSubmitting ? RECONCILE_MODAL_COPY.submitting : RECONCILE_MODAL_COPY.submit}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </AdaptiveModal>
      )}

      {showInventoryModal && (
        <AdaptiveModal open={showInventoryModal} onClose={() => setShowInventoryModal(false)} size="md" zIndex={300} panelClassName="flex h-full max-h-[92vh] flex-col">
          <div className={`${modalShellClassName} max-w-2xl`}>
            <div className="relative overflow-hidden bg-[linear-gradient(135deg,#14532d_0%,#16a34a_55%,#86efac_100%)] px-6 py-6 text-white md:px-8">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.16),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(187,247,208,0.22),transparent_34%)]" />
              <div className="relative flex items-start justify-between gap-4">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-black tracking-[0.18em]">AGENT STOCK SNAPSHOT</div>
                  <h3 className="mt-3 text-2xl font-black">????? ???????</h3>
                  <p className="mt-2 max-w-xl text-sm font-medium leading-6 text-emerald-50/90">???? ????? ????? ??????? ??????? ?? ??????? ????? ??????? ??????.</p>
                </div>
                <button onClick={() => loadAgentInventory(selectedAgentId)} className="rounded-2xl border border-white/20 bg-white/10 p-3 text-white transition hover:bg-white/20">
                  <RefreshCw size={16} />
                </button>
              </div>
            </div>
            <div className="space-y-5 px-6 py-6 md:px-8">
              <div className={modalListPanelClassName}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-black tracking-[0.18em] text-slate-400">?????? ??????</div>
                    <div className="mt-1 text-sm font-bold text-slate-700">{agentInventory.length} ???? ?? ???? ???????</div>
                  </div>
                  <div className="rounded-2xl bg-emerald-50 px-3 py-2 text-center text-xs font-black text-emerald-700">
                    {agentInventory.reduce((sum, line) => sum + Number(line.quantity || 0), 0)} ????
                  </div>
                </div>
                <div className="mt-4 max-h-72 space-y-2 overflow-y-auto custom-scrollbar">
                  {agentInventory.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm font-bold text-slate-400">?? ???? ????? ???? ??????? ??????.</div>
                  ) : (
                    agentInventory.map(line => (
                      <div key={line.id} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm">
                        <div>
                          <div className="font-black text-slate-800">{line.itemName || line.itemId}</div>
                          <div className="text-xs font-bold text-slate-400">{line.unitName || '???? ????????'}</div>
                        </div>
                        <div className="rounded-2xl bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-700">{line.quantity}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="flex justify-end">
                <button onClick={() => setShowInventoryModal(false)} className={modalGhostButtonClassName}>?????</button>
              </div>
            </div>
          </div>
        </AdaptiveModal>
      )}

      {partyDraft && (
        <AdaptiveModal open={!!partyDraft} onClose={() => setPartyDraft(null)} size="md" zIndex={300} panelClassName="flex h-full max-h-[92vh] flex-col">
          <div className={`${modalShellClassName} max-w-2xl`}>
            <div className={`relative overflow-hidden px-6 py-6 text-white md:px-8 ${partyDraft.type === 'CUSTOMER' ? 'bg-[linear-gradient(135deg,#14532d_0%,#16a34a_60%,#86efac_100%)]' : 'bg-[linear-gradient(135deg,#7c2d12_0%,#ea580c_60%,#fdba74_100%)]'}`}>
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.18),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.1),transparent_34%)]" />
              <div className="relative">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-black tracking-[0.18em]">
                  {partyDraft.type === 'CUSTOMER' ? 'MAP CUSTOMER' : 'MAP SUPPLIER'}
                </div>
                <h3 className="mt-3 text-2xl font-black">????? {partyDraft.type === 'CUSTOMER' ? '????' : '????'} ??? ???????</h3>
                <p className="mt-2 max-w-xl text-sm font-medium leading-6 text-white/90">???? ????? ?????? ?? ??????? ?? ?????????? ??????? ????? ??? ?????? ???????? ???????.</p>
              </div>
            </div>
            <div className="space-y-5 px-6 py-6 md:px-8">
              <div className="grid gap-3">
                <input className={modalFieldClassName} placeholder="?????" value={partyDraft.name} onChange={e => setPartyDraft({ ...partyDraft, name: e.target.value })} />
                <input className={modalFieldClassName} placeholder="??????" value={partyDraft.phone} onChange={e => setPartyDraft({ ...partyDraft, phone: e.target.value })} />
                <input className={modalFieldClassName} placeholder="???????" value={partyDraft.address} onChange={e => setPartyDraft({ ...partyDraft, address: e.target.value })} />
                <input className={modalFieldClassName} placeholder="????? ?????? (???????)" value={partyDraft.label} onChange={e => setPartyDraft({ ...partyDraft, label: e.target.value })} />
              </div>
              <div className={modalListPanelClassName}>
                <div className="text-xs font-black tracking-[0.18em] text-slate-400">???????? ?????</div>
                <div className="mt-2 grid grid-cols-2 gap-3 text-sm font-black text-slate-700">
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">?? ?????: {partyDraft.lat.toFixed(5)}</div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">?? ?????: {partyDraft.lng.toFixed(5)}</div>
                </div>
              </div>
              <div className="flex flex-col-reverse gap-3 pt-2 md:flex-row md:justify-end">
                <button onClick={() => setPartyDraft(null)} className={modalGhostButtonClassName}>?????</button>
                <button disabled={isSubmitting} onClick={createPartyFromMap} className={`rounded-2xl px-5 py-3 text-sm font-black text-white shadow-lg transition hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-60 ${partyDraft.type === 'CUSTOMER' ? 'bg-[linear-gradient(135deg,#166534_0%,#16a34a_100%)] shadow-emerald-200' : 'bg-[linear-gradient(135deg,#c2410c_0%,#ea580c_100%)] shadow-orange-200'}`}>
                  {isSubmitting ? '???? ?????...' : '??? ??? ???????'}
                </button>
              </div>
            </div>
          </div>
        </AdaptiveModal>
      )}
    </div>
  );
};

export default Agents;
