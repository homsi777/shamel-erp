import React from 'react';
import type { Client, InventoryItem, Warehouse } from '../types';
import TextileDispatches from './TextileDispatches';

interface TextileDispatchApprovalsProps {
  items: InventoryItem[];
  clients: Client[];
  warehouses: Warehouse[];
}

const TextileDispatchApprovals: React.FC<TextileDispatchApprovalsProps> = (props) => {
  return <TextileDispatches {...props} approvalMode />;
};

export default TextileDispatchApprovals;
