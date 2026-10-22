// PROTOTYPE: three structurally different variants of the main Canvas, switchable via ?variant=A|B|C.
import { useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { StoreProvider } from './model/store';
import { PrototypeSwitcher } from './PrototypeSwitcher';
import { VariantA, variantAName } from './variants/A';
import { VariantB, variantBName } from './variants/B';
import { VariantC, variantCName } from './variants/C';

const VARIANTS = [
  { key: 'A', name: variantAName, C: VariantA },
  { key: 'B', name: variantBName, C: VariantB },
  { key: 'C', name: variantCName, C: VariantC },
];

export function App() {
  const [variant, setVariant] = useState(() => new URLSearchParams(location.search).get('variant')?.toUpperCase() ?? 'A');
  const change = (k: string) => {
    const url = new URL(location.href);
    url.searchParams.set('variant', k);
    history.replaceState(null, '', url);
    setVariant(k);
  };
  const V = (VARIANTS.find((v) => v.key === variant) ?? VARIANTS[0]).C;
  return (
    <StoreProvider>
      <ReactFlowProvider key={variant}>
        <V />
      </ReactFlowProvider>
      <PrototypeSwitcher variants={VARIANTS} current={variant} onChange={change} />
    </StoreProvider>
  );
}
