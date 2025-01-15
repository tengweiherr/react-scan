'use client';
import { useEffect, useState } from 'react';
import { scan } from 'react-scan';

export default function ToggleScan(): JSX.Element {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    scan({
      enabled,
      dangerouslyForceRunInProduction: true,
      // monitor: {
      //   url: 'https://localhost:3000/api/scan',
      // },
    });
  }, [enabled]);

  function toggle() {
    setEnabled(!enabled);
  }

  return (
    <button type="button" onClick={toggle}>
      {enabled ? 'Disable' : 'Enable'} Scan
    </button>
  );
}
