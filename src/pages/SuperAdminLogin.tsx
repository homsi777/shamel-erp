import React from 'react';
import Login from './Login';
import type { AppUser } from '../types';

interface Props {
  onLoginSuccess: (user: AppUser) => void;
}

const SuperAdminLogin: React.FC<Props> = ({ onLoginSuccess }) => {
  return <Login onLoginSuccess={onLoginSuccess} />;
};

export default SuperAdminLogin;
