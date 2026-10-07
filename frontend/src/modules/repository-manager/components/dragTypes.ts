/** Private MIME types of in-app drags; drops of files or text are ignored. */
export const SCRIPT_DRAG_TYPE = "application/x-repodock-script"
export const QUICK_DRAG_TYPE = "application/x-repodock-quick"

/** True when the drag carries one of the given in-app types (readable during dragover). */
export const dragHas = (event: React.DragEvent, ...types: string[]) => types.some((type) => event.dataTransfer.types.includes(type))
