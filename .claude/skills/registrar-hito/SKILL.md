---
name: registrar-hito
description: Dejar constancia en .claude/hitos/ de un cambio relevante en VentasMaker o en una tienda hecha con él. Úsala al terminar un trabajo con sustancia (tienda nueva publicada, acción o vista nueva, migración de catálogo, auditoría, cambio de backend) o cuando el usuario pida "registra esto", "anota el hito" o pregunte "¿en qué estábamos?".
---

# Registrar un hito

Los hitos son la memoria: **qué** se hizo, **cuándo** y sobre todo **por qué**.
El `CLAUDE.md` describe cómo se trabaja hoy; los hitos, cómo se llegó hasta
aquí; las skills, cómo se hace algo paso a paso. No se mezclan.

**Un hito no se edita ni se borra.** Si una decisión cambió, se escribe otro
que referencie al anterior.

## ¿De quién es el hito?

| El cambio afecta a… | Va en |
|---|---|
| Esta tienda (sus datos, su backend, su despliegue) | `.claude/hitos/` de este repo |
| Algo que le pasaría igual a **cualquier** tienda hecha desde VentasMaker | además, corregirlo en VentasMaker (código o skill) y registrarlo en `VentasMaker/.claude/hitos/` |

Sin la segunda anotación, la siguiente tienda repite el error.

## Cuándo SÍ

- Una tienda nueva publicada (siempre es el `0001` de su repo).
- Una acción de backend o una vista del panel nuevas.
- Una migración de catálogo.
- Una auditoría de seguridad o un arreglo de seguridad.
- Decisiones técnicas con alternativas descartadas.

## Cuándo NO

Typos, un color, un producto cambiado. Lo que el `git log` cuenta igual de bien.

Si dudas: **¿le serviría a alguien que retome esto en seis meses?**

## Cómo

1. **Número:** `ls .claude/hitos/` → siguiente de cuatro dígitos,
   `NNNN-slug-sin-acentos.md` (GitHub distingue mayúsculas; el enlace del
   índice se rompe con un acento de más).
2. **Escribir** con todas las secciones; si una no aplica, «Ninguna»:

```markdown
# NNNN — Título corto y concreto

- **Fecha:** YYYY-MM-DD
- **Estado:** completado | en curso | revertido
- **Commits:** `hash` (o "pendiente de commit")

## Contexto
Qué había antes y qué problema concreto tenía.

## Qué se hizo
Cambios reales, con rutas de archivos.

## Decisiones y alternativas descartadas
Lo más valioso. Qué se eligió, contra qué, y por qué.

## Consecuencias
Qué cambia para quien trabaje en esto desde ahora.

## Pendiente
Lo que quedó fuera a propósito. Incluye «redesplegar Apps Script» si el
cambio tocó `backend/Code.gs` y la dueña aún no lo ha hecho.
```

   En español, en pasado, concreto, con **fechas absolutas**. Sin firma ni
   atribución a Claude (convención de `../CLAUDE.md`).
3. **Índice:** una fila en `.claude/hitos/README.md`, la más reciente arriba.
4. **¿Cambió cómo se trabaja?** Actualiza `CLAUDE.md`. ¿Cambió un
   procedimiento? Actualiza la skill: una skill que enseña algo que ya no es
   verdad hace más daño que no tenerla.
