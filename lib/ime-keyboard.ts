type CompositionKeyboardEvent = {
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
};

/** Safari may clear isComposing on the Enter that confirms a conversion. */
export function isImeComposing(event: CompositionKeyboardEvent): boolean {
  return event.isComposing === true || event.keyCode === 229 ||
    event.nativeEvent?.isComposing === true || event.nativeEvent?.keyCode === 229;
}
