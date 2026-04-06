import React from 'react';
import ActivationStep from '../modules/setup/components/ActivationStep';

interface ActivationProps {
  onActivationSuccess: (activationType: string) => void;
}

const Activation: React.FC<ActivationProps> = ({ onActivationSuccess }) => {
  return <ActivationStep variant="page" onActivationSuccess={onActivationSuccess} />;
};

export default Activation;
