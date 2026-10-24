import DefaultTheme from 'vitepress/theme';
import mermaid from 'mermaid';
import iconPack from 'virtual:weld-icons';

// Иконки диаграмм: mermaid рисует только встроенные file/folder, остальное
// приходит из пака, зарегистрированного здесь (см. mermaid-icons.ts).
mermaid.registerIconPacks([{ name: iconPack.prefix, icons: iconPack }]);

export default DefaultTheme;
