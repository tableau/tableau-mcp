#!/usr/bin/env python3

"""
🚀 Tableau MCP Evaluation Launcher
Simple script to choose between different evaluation modes
"""

import asyncio
import subprocess
import sys
from pathlib import Path


def show_banner():
    """Show the evaluation banner"""
    print("="*80)
    print("🚀 TABLEAU MCP SERVER EVALUATION")
    print("="*80)
    print("Choose your evaluation mode:")
    print("")


def show_options():
    """Show available evaluation options"""
    print("📊 AVAILABLE EVALUATIONS:")
    print("")
    print("1. 🔓 FULL EVALUATION (Recommended)")
    print("   • All 114 test cases")
    print("   • All 3 databases: california_schools, card_games, financial")  
    print("   • All difficulty levels: simple, moderate, challenging")
    print("   • Complete VDS query capture")
    print("   • Estimated time: ~3 hours")
    print("")
    print("2. 🔒 LIMITED EVALUATION (Quick Test)")
    print("   • Only 6 test cases")
    print("   • 2 databases: california_schools, card_games")
    print("   • Only simple difficulty")
    print("   • For testing/debugging")
    print("   • Estimated time: ~10 minutes")
    print("")
    print("3. 🔍 CHECK TEST CASES")
    print("   • See how many test cases are available")
    print("   • View database and difficulty breakdown")
    print("   • No actual evaluation")
    print("")
    print("4. 🧪 TEST CONNECTION")
    print("   • Verify MCP server connectivity")
    print("   • Test authentication")
    print("   • Quick health check")
    print("")
    print("5. ❌ EXIT")
    print("")


def main():
    """Main launcher"""
    show_banner()
    show_options()
    
    while True:
        try:
            choice = input("Choose an option (1-5): ").strip()
            
            if choice == "1":
                print("\n🚀 Starting FULL evaluation (114 test cases)...")
                print("This will run all test cases across all databases and difficulties.")
                confirm = input("Continue? (y/N): ").strip().lower()
                if confirm == 'y':
                    subprocess.run([sys.executable, "run_full_evaluation.py", "1"])
                break
                
            elif choice == "2":
                print("\n🔒 Starting LIMITED evaluation (6 test cases)...")
                print("This will run a small subset for quick testing.")
                subprocess.run([sys.executable, "run_limited_evaluation.py"])
                break
                
            elif choice == "3":
                print("\n🔍 Checking available test cases...")
                subprocess.run([sys.executable, "check_test_cases.py"])
                print("\nPress Enter to return to menu...")
                input()
                show_banner()
                show_options()
                
            elif choice == "4":
                print("\n🧪 Testing MCP server connection...")
                subprocess.run([sys.executable, "test_connection.py"])
                print("\nPress Enter to return to menu...")
                input()
                show_banner() 
                show_options()
                
            elif choice == "5":
                print("\n👋 Goodbye!")
                break
                
            else:
                print(f"❌ Invalid choice: {choice}")
                print("Please choose 1, 2, 3, 4, or 5")
                continue
                
        except KeyboardInterrupt:
            print("\n\n👋 Goodbye!")
            break
        except Exception as e:
            print(f"❌ Error: {e}")
            break


if __name__ == "__main__":
    main() 