import { createRoot } from 'react-dom/client';
import type { CharacterId, MochiColor } from '../../shared/settings';
import { Mascot } from '../../src/features/mascot/Mascot';
import type { MascotState } from '../../src/features/mascot/mascotStates';

/**
 * Página usada SÓ pelo script `scripts/render-poses.cjs` para gerar as imagens do widget (uma por personagem,
 * cor, acessório e pose). Parâmetros: ?c=cactus&color=mint&skin=cactus.escuros&state=happy
 */
const q = new URLSearchParams(location.search);
const character = (q.get('c') ?? 'mochi') as CharacterId;
const color = (q.get('color') ?? 'mint') as MochiColor;
const skin = q.get('skin');
const state = (q.get('state') ?? 'idle') as MascotState;

createRoot(document.getElementById('pose') as HTMLElement).render(
  <Mascot state={state} replay={0} hop={false} blinking={false} mood="mid" character={character} palette={color} skin={skin || null} uid="p" />,
);
(window as unknown as { __poseReady: boolean }).__poseReady = true;
