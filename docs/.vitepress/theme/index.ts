import DefaultTheme from 'vitepress/theme';
import mermaid from 'mermaid';
import iconPack from 'virtual:weld-icons';

mermaid.registerIconPacks([{ name: iconPack.prefix, icons: iconPack }]);

export default DefaultTheme;
