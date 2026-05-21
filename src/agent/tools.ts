export const toolSchemas = [
  {
    type: 'function',
    function: {
      name: 'execute_bash',
      description: 'Execute a bash command on the local system inside a clean environment.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The exact bash command to execute.'
          },
          working_directory: {
            type: 'string',
            description: 'Optional absolute path to the directory to run the command in. Defaults to the current active environment directory.'
          }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'manage_file',
      description: 'Perform non-destructive operations on filesystem files: reading, creating new files, or patching existing config files.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['read', 'create', 'patch'],
            description: 'The action to perform on the target file.'
          },
          path: {
            type: 'string',
            description: 'The absolute file path to the target file. Resolves ~ to home directory.'
          },
          content: {
            type: 'string',
            description: 'Mandatory for "create" action. The raw content buffer to write to the new file.'
          },
          search: {
            type: 'string',
            description: 'Mandatory for "patch" action. The exact multi-line string block within the existing file to search for and replace.'
          },
          replace: {
            type: 'string',
            description: 'Mandatory for "patch" action. The multi-line replacement block that substitutes the search block.'
          }
        },
        required: ['action', 'path']
      }
    }
  }
];
