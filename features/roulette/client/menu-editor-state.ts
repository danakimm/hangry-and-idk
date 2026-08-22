import { defaultMenuEmoji } from "../shared/constants.ts";

export type MenuEditorFormState = {
  inputText: string;
  emoji: string;
  isPickerOpen: boolean;
};

export function applyResetTransition(
  current: MenuEditorFormState,
): MenuEditorFormState {
  return {
    inputText: current.inputText,
    emoji: defaultMenuEmoji,
    isPickerOpen: false,
  };
}

export function applySubmitTransition(): MenuEditorFormState {
  return {
    inputText: "",
    emoji: defaultMenuEmoji,
    isPickerOpen: false,
  };
}
