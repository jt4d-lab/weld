// Файл глобальный: обычный `import type` превратил бы его в модуль, а
// `declare module` — в дополнение несуществующего модуля.
declare module 'virtual:weld-icons' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports
    const pack: import('@iconify/types').IconifyJSON;
    export default pack;
}
