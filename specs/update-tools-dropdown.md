# Improve the tools dropdown

- Replace the trigger with a button that uses the lucide icon for settings, add tooltip for tools. Use shadcn for that.
- Hard-code some icons for known tools. These are the tools we know right now. Pick some icons from lucide.

```ts
;['web_search', 'code_execution', 'image_generation']
```

For other tools, use the default wrench icon.

- Change the dropdown from checkboxes to icons on the left, and switch component on the right, use shadcn for that.
