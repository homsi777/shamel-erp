import React from 'react';
import type { RestaurantTable } from './restaurant.types';
import TableOrderWorkspace from './order-workspace/TableOrderWorkspace';

export interface RestaurantSessionPanelProps {
  sessionId: string | null;
  table?: RestaurantTable | null;
  canManageSessions: boolean;
  canManageTables?: boolean;
  variant?: 'drawer' | 'side' | 'modal';
  onClosePanel: () => void;
  onSessionsChanged: () => void;
}

const RestaurantSessionPanel: React.FC<RestaurantSessionPanelProps> = (props) => {
  return <TableOrderWorkspace {...props} />;
};

export default RestaurantSessionPanel;

