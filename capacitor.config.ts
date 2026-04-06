
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.shamel.erp',
  appName: 'Shamel ERP Management',
  webDir: 'dist',
  server: {
    androidScheme: 'http', 
    cleartext: true, 
    allowNavigation: ['*']
  },
  plugins: {
    CapacitorSQLite: {
      androidIsEncryption: false,
      androidBiometric: {
        biometricAuth: false,
        biometricTitle: 'Shamel Local Database',
        biometricSubTitle: 'Authenticate to access the embedded database'
      }
    },
    Keyboard: {
      resize: 'body',
      style: 'dark',
      scrollToInput: true,
    },
    StatusBar: {
      style: 'dark',
      backgroundColor: '#0f766e', 
    }
  }
};

export default config;
