# Зависимости модулей

```mermaid
flowchart TD
    subgraph input
        direction TB

        rules

        cli
    end

    tsconfig
    imports
    config
    settings

    input --> config
    input --> settings
    input --> imports
    input --> host

    config --> settings
    config --> tsconfig
    config --> host

    host --> settings

    tsconfig --> settings

    imports --> settings
```
