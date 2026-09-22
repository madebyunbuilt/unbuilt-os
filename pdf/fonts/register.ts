import { Font } from '@react-pdf/renderer';
import { DANCING_SCRIPT_TTF, SIGNATURE_FONT_FAMILY } from './dancing-script';

// Registers the signature face once, for every PDF template that draws a typed signature.
Font.register({ family: SIGNATURE_FONT_FAMILY, src: DANCING_SCRIPT_TTF, fontWeight: 500 });

export { SIGNATURE_FONT_FAMILY };
