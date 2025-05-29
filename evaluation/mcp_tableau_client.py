"""
MCP Tableau Client using OpenAI Agent SDK
Connects to the Tableau MCP server and executes VDS queries
"""

import asyncio
import os
import json
from typing import Dict, Any, List, Optional
from pathlib import Path

from openai import AsyncOpenAI
from agents import Agent, Runner, gen_trace_id, trace
from agents.mcp import MCPServerStdio
from agents.model_settings import ModelSettings
from dotenv import load_dotenv


class TableauMCPClient:
    """Client for interacting with Tableau MCP server using OpenAI Agent SDK"""
    
    def __init__(self, mcp_server_path: str = None, openai_api_key: str = None, env_file: str = None):
        """
        Initialize the Tableau MCP client
        
        Args:
            mcp_server_path: Path to the Tableau MCP server (defaults to built index.js)
            openai_api_key: OpenAI API key for the agent
            env_file: Path to .env file containing Tableau credentials
        """
        # Load environment variables from .env file
        if env_file:
            load_dotenv(env_file, override=True)  # Force override of existing env vars
        else:
            # Try to find .env in project root
            project_root = Path(__file__).parent.parent
            env_path = project_root / ".env"
            if env_path.exists():
                load_dotenv(env_path, override=True)  # Force override of existing env vars
        
        self.mcp_server_path = mcp_server_path or str(Path(__file__).parent.parent / "build" / "index.js")
        self.openai_api_key = openai_api_key or os.getenv("OPENAI_API_KEY")
        
        if not self.openai_api_key:
            raise ValueError("OpenAI API key is required")
            
        # Set the API key for the agent SDK
        os.environ["OPENAI_API_KEY"] = self.openai_api_key
        
    async def query_datasource(self, datasource_name: str, natural_language_query: str) -> Dict[str, Any]:
        """
        Execute a natural language query against a Tableau datasource
        
        Args:
            datasource_name: Name of the Tableau datasource (e.g., "california_schools")
            natural_language_query: Natural language question to answer
            
        Returns:
            Dictionary containing the query results or error information
        """
        # Simplified instructions that handle auth failures gracefully
        agent_instructions = f"""
        You are a Tableau VDS query assistant. Your job is to answer questions using the {datasource_name} datasource.
        
        Steps to follow:
        1. Try to list datasources and find one matching '{datasource_name}'
        2. If that works, try to list fields for the datasource to understand the schema
        3. Construct and execute a VDS query to answer the question

        Remember: VDS queries use a specific schema with fields array containing objects with:
        - fieldCaption (required): exact field name
        - function (optional): aggregation function
        - sortDirection (optional): ASC or DESC
        - sortPriority (optional): integer for multi-field sorting
        
        IMPORTANT: In your final response, always include the VDS query you constructed in this exact format:
        VDS_QUERY: {{your_vds_query_json_here}}
        
        If authentication fails or datasources aren't available:
        - Respond with "Unable to access Tableau datasources due to authentication issues"
        - Do not retry indefinitely
        
        Keep your response concise and focused on answering the user's question.
        """
        
        # Create environment for the subprocess
        env = os.environ.copy()
        
        trace_id = gen_trace_id()
        result_data = {
            "datasource": datasource_name,
            "query": natural_language_query,
            "trace_id": trace_id,
            "success": False,
            "data": None,
            "error": None,
            "vds_query": None
        }
        
        try:
            # Add timeout using asyncio.wait_for
            async with MCPServerStdio(
                name="Tableau MCP Server",
                params={
                    "command": "node",
                    "args": [self.mcp_server_path],
                    "env": env,
                },
            ) as mcp_server:
                # Create an agent with the MCP server
                agent = Agent(
                    name="TableauVDSAgent",
                    instructions=agent_instructions,
                    mcp_servers=[mcp_server],
                    model="gpt-4o-mini",  # Use faster model for testing
                    model_settings=ModelSettings(
                        temperature=0.1,
                        tool_choice="auto"
                    )
                )
                
                # Construct a simple user message
                user_message = f"Answer this question about {datasource_name}: {natural_language_query}"
                
                # Run the agent with a timeout
                with trace(workflow_name="Tableau VDS Query", trace_id=trace_id):
                    # 60 second timeout to prevent hanging
                    result = await asyncio.wait_for(
                        Runner.run(
                            starting_agent=agent,
                            input=user_message
                        ),
                        timeout=60.0
                    )
                    
                    # Extract the results
                    result_data["success"] = True
                    result_data["data"] = result.final_output
                    
                    # Try to extract VDS query from the response
                    if result.final_output and "VDS_QUERY:" in result.final_output:
                        try:
                            # Find the VDS_QUERY section and extract the JSON
                            vds_start = result.final_output.find("VDS_QUERY:") + len("VDS_QUERY:")
                            vds_section = result.final_output[vds_start:].strip()
                            
                            # Try to find JSON-like content (look for first { to matching })
                            if vds_section.startswith("{"):
                                brace_count = 0
                                end_pos = 0
                                for i, char in enumerate(vds_section):
                                    if char == "{":
                                        brace_count += 1
                                    elif char == "}":
                                        brace_count -= 1
                                        if brace_count == 0:
                                            end_pos = i + 1
                                            break
                                
                                if end_pos > 0:
                                    vds_json_str = vds_section[:end_pos]
                                    result_data["vds_query"] = json.loads(vds_json_str)
                        except (json.JSONDecodeError, ValueError) as e:
                            # If parsing fails, just store the raw text
                            result_data["vds_query"] = f"Parse error: {str(e)}"
        except asyncio.TimeoutError:
            result_data["error"] = "Query timed out after 60 seconds"
        except Exception as e:
            result_data["error"] = str(e)
            
        return result_data
    
    async def list_datasources(self) -> List[Dict[str, Any]]:
        """List all available Tableau datasources"""
        # Create environment for the subprocess
        env = os.environ.copy()
        
        try:
            async with MCPServerStdio(
                name="Tableau MCP Server",
                params={
                    "command": "node",
                    "args": [self.mcp_server_path],
                    "env": env,  # Pass all environment variables
                },
            ) as mcp_server:
                agent = Agent(
                    name="TableauListAgent",
                    instructions="List all available Tableau datasources using the list-datasources tool. If authentication fails, respond with an error message.",
                    mcp_servers=[mcp_server],
                    model="gpt-4o-mini"
                )
                
                # Add timeout protection here too
                result = await asyncio.wait_for(
                    Runner.run(
                        starting_agent=agent,
                        input="List all available datasources"
                    ),
                    timeout=30.0
                )
                
                return result.final_output
        
        except asyncio.TimeoutError:
            return "Error: Timeout while listing datasources"
        except Exception as e:
            return f"Error: {str(e)}"


# Example usage
async def main():
    client = TableauMCPClient()
    
    # Example query
    result = await client.query_datasource(
        "california_schools",
        "What is the average SAT math score for schools in Los Angeles?"
    )
    
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    asyncio.run(main()) 