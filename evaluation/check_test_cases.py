#!/usr/bin/env python3

"""
Script to check how many test cases are available in the bird-mini dataset
"""

from test_loader import BirdMiniTestLoader

def check_test_cases():
    """Check the actual number of test cases available"""
    loader = BirdMiniTestLoader()
    
    print("🔍 BIRD-MINI TEST CASE ANALYSIS")
    print("="*50)
    
    # Load all test cases
    all_test_cases = loader.load_test_cases()
    total_stats = loader.get_statistics(all_test_cases)
    
    print(f"📊 TOTAL TEST CASES: {total_stats['total']}")
    print(f"📁 By Database:")
    for db, count in total_stats['by_database'].items():
        print(f"  {db}: {count}")
    
    print(f"📈 By Difficulty:")
    for diff, count in total_stats['by_difficulty'].items():
        print(f"  {diff}: {count}")
    
    # Check our 3 target databases specifically
    print("\n🎯 TARGET DATABASES ANALYSIS")
    print("="*50)
    
    target_dbs = ["california_schools", "card_games", "financial"]
    target_test_cases = loader.load_test_cases(databases=target_dbs)
    target_stats = loader.get_statistics(target_test_cases)
    
    print(f"📊 TARGET DATABASE TEST CASES: {target_stats['total']}")
    print(f"📁 By Database:")
    for db in target_dbs:
        count = target_stats['by_database'].get(db, 0)
        print(f"  {db}: {count}")
    
    print(f"📈 By Difficulty:")
    for diff, count in target_stats['by_difficulty'].items():
        print(f"  {diff}: {count}")
    
    # Show current limited configuration vs full
    print("\n⚙️ CURRENT CONFIGURATION COMPARISON")
    print("="*50)
    
    # Current limited config
    limited_cases = loader.load_test_cases(
        databases=["california_schools", "card_games"],
        difficulty_filter=["simple"],
        limit=3
    )
    limited_stats = loader.get_statistics(limited_cases)
    
    print(f"🔒 CURRENT LIMITED: {limited_stats['total']} test cases")
    print(f"🔓 FULL EVALUATION: {target_stats['total']} test cases")
    print(f"📈 DIFFERENCE: {target_stats['total'] - limited_stats['total']} more test cases available!")
    
    return target_stats

if __name__ == "__main__":
    check_test_cases() 